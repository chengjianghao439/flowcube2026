'use strict'

/**
 * 批 B3b · 装箱配额与回收：`package_items` 按**来源取货标签**分行。
 *
 * 断言口径：HTTP 状态码 + **数据库事实**（`package_items.label_container_id` 与各行数量、
 * `warehouse_task_items` 不变、`packages.status`）。任一项失败即 `process.exitCode = 1`。
 *
 * 只在显式回环独立测试库运行：先断言确切库名/回环/端口，不符即失败（防止误连共享库）。
 */
const assert = require('node:assert/strict')

const EXPECTED_DB = 'flowcube_plastic_box_20260929_test'
assert.equal(process.env.DB_NAME, EXPECTED_DB, `本批用例只允许在 ${EXPECTED_DB} 运行，实际 ${process.env.DB_NAME}`)
assert.equal(process.env.DB_HOST, '127.0.0.1', '必须走本机回环')
assert.equal(Number(process.env.DB_PORT), 3307, '必须走本机 3307')

const {
  prepareSmokeContext, login, dbQuery, randomRef,
  createPurchaseOrder, confirmPurchaseOrder, createInboundTaskFromPurchase,
} = require('./helpers/smokeTestKit')

async function main() {
  let ctx
  try {
    ctx = await prepareSmokeContext({ requestTimeoutMs: 30000 })
  } catch (e) {
    // 初始化阶段失败（例如迁移 SQL 语法错误）时，全局连接池已经建好，不显式收口进程会吊着不退，
    // 看起来像"还在跑"——必须在这里关掉再抛，避免把"等待"误当成"通过"。
    try { await require('../backend/src/config/db').pool.end() } catch (e2) { console.error(`[FAIL] 初始化失败后关池出错：${e2.message}`) }
    throw e
  }
  const { pool, http, warehouse, location, product, supplier, customer, pdaHeaders, close } = ctx

  let token
  try {
    const authed = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    token = authed.token
    assert.ok(token, '管理员应登录成功')
  } catch (e) {
    try { await close() } catch (e2) { console.error(`[FAIL] 登录失败后释放出错：${e2.message}`) }
    try { await require('../backend/src/config/db').pool.end() } catch (e2) { console.error(`[FAIL] 登录失败后关池出错：${e2.message}`) }
    throw e
  }

  let passed = 0
  let failed = 0
  const check = async (title, fn) => {
    try { await fn(); passed++; console.log(`[PASS] ${title}`) }
    catch (e) { failed++; console.error(`[FAIL] ${title}\n        ${e.message}`) }
  }

  const key = (p) => `${p}-${randomRef('K')}`

  async function makeWholeContainer(qty) {
    const po = await createPurchaseOrder(http, token, { supplier, warehouse, product, quantity: qty })
    assert.equal(po.status, 201, `采购单创建失败：${JSON.stringify(po.data).slice(0, 200)}`)
    const poId = po.data.data.id
    assert.equal((await confirmPurchaseOrder(http, token, poId)).status, 200, '采购确认失败')
    const it = await createInboundTaskFromPurchase(http, token, poId)
    assert.equal(it.status, 201, `入库任务创建失败：${JSON.stringify(it.data).slice(0, 200)}`)
    const taskId = it.data.data.taskId ?? it.data.data.id
    assert.equal((await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })).status, 200, '入库提交失败')
    const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
      token, headers: pdaHeaders(), json: { productId: product.id, qty },
    })
    assert.equal(recv.status, 200, `收货失败：${JSON.stringify(recv.data).slice(0, 200)}`)
    const cid = recv.data.data.containerId
    const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
      token, headers: pdaHeaders(), json: { containerId: cid, locationId: location.id },
    })
    assert.equal(put.status, 200, `上架失败：${JSON.stringify(put.data).slice(0, 200)}`)
    return cid
  }

  async function createEmptyBox() {
    const r = await http.post('/api/plastic-boxes', {
      token, json: { productId: product.id, warehouseId: warehouse.id, locationId: location.id },
    })
    assert.equal(r.status, 201, `建盒失败：${JSON.stringify(r.data).slice(0, 200)}`)
    return r.data.data.id
  }

  const fillReq = (boxId, sourceContainerId, k) =>
    http.post(`/api/plastic-boxes/${boxId}/fill`, { token, headers: { 'X-Request-Key': k }, json: { sourceContainerId } })

  const createdSales = []
  const createdBins = []

  async function saleToTask(qty) {
    // 分拣格在**进入拣货(2)时**由 on-enter 动作分配，必须先备好空闲格，否则任务永远无格可用
    await ensureFreeBin()
    const sale = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('pb-pack'),
        items: [{
          productId: Number(product.id), productCode: product.code, productName: product.name,
          unit: product.unit, quantity: qty, unitPrice: 10,
        }],
      },
    })
    assert.equal(sale.status, 201, `建销售单失败：${JSON.stringify(sale.data).slice(0, 200)}`)
    const saleId = Number(sale.data.data.id)
    createdSales.push({ saleId, taskId: null })
    assert.equal((await http.post(`/api/sale/${saleId}/reserve`, { token })).status, 200, '占库失败')
    const ship = await http.post(`/api/sale/${saleId}/ship`, { token })
    assert.ok(ship.ok, `发货(生成任务)失败：${JSON.stringify(ship.data).slice(0, 200)}`)
    const [so] = await dbQuery(pool, 'SELECT task_id FROM sale_orders WHERE id=?', [saleId])
    const taskId = Number(so.task_id)
    const [wti] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=? ORDER BY id LIMIT 1', [taskId])
    createdSales[createdSales.length - 1].taskId = taskId
    return { saleId, taskId, itemId: Number(wti.id) }
  }

  const pickScan = (taskId, itemId, containerId, barcode, qty, k) =>
    http.post('/api/scan-logs', {
      token,
      headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) },
      json: { taskId, itemId, containerId, barcode, productId: Number(product.id), qty, scanMode: '整件' },
    })

  const checkScan = (taskId, barcode, k) =>
    http.post('/api/scan-logs/check', {
      token,
      headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) },
      json: { taskId, barcode },
    })

  const readyApi = (taskId) => http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: pdaHeaders() })

  const sortDoneRaw = (taskId, items, k) =>
    http.put(`/api/warehouse-tasks/${taskId}/sort-done`, {
      token, headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) }, json: { items },
    })

  async function ensureFreeBin() {
    const list = await http.get(`/api/sorting-bins/warehouse/${warehouse.id}`, { token })
    const free = (list.data?.data ?? []).find(b => Number(b.status) === 1)
    if (free) return free
    const code = `PK${String(randomRef('B')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`
    const created = await http.post('/api/sorting-bins', {
      token, json: { code, warehouseId: Number(warehouse.id), remark: 'pb-pack' },
    })
    assert.ok(created.ok, `自建分拣格失败：${JSON.stringify(created.data).slice(0, 200)}`)
    const id = Number(created.data.data.id)
    createdBins.push(id)
    return { id, code, status: 1 }
  }

  const createPackageApi = (taskId) =>
    http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: taskId } })

  const addByCode = (pkgId, productCode, qty, k) =>
    http.post(`/api/packages/${pkgId}/add-item`, {
      token, headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) },
      json: { productCode, qty },
    })

  // 传**条码**而不是容器 id：`I` 码的条码是独立序号，与 `inventory_containers.id` 不相等，
  // PDA 端也只能拿到扫到的字符串
  const addByLabel = (pkgId, labelBarcode, k, qty) =>
    http.post(`/api/packages/${pkgId}/add-item`, {
      token, headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) },
      json: qty === undefined ? { labelBarcode } : { labelBarcode, qty },
    })

  const removeItemApi = (pkgId, itemId, qty, k) =>
    http.post(`/api/packages/${pkgId}/remove-item`, {
      token, headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) },
      json: qty === undefined ? { itemId } : { itemId, qty },
    })

  const voidPkgApi = (pkgId) => http.post(`/api/packages/${pkgId}/void`, { token, headers: pdaHeaders() })

  const pkgItems = async (pkgId) =>
    dbQuery(pool, 'SELECT id, product_id, qty, label_container_id FROM package_items WHERE package_id=? ORDER BY id', [pkgId])
  const pkgRow = async (pkgId) =>
    (await dbQuery(pool, 'SELECT status, warehouse_task_id FROM packages WHERE id=?', [pkgId]))[0]

  /**
   * 真实链造一个「待打包」(5) 的任务：整件 I(50) 走旧商品码 + 盒取两张取货码(60/90)，
   * 拣货 → ready → 分拣 → 逐容器真实复核 ⇒ checked=200，其中标签 CHECK 量 60+90、旧 SKU 50。
   * @param {'legacy-first'|'label-first'} order 分拣顺序（两种都验）
   */
  async function taskAtPacking(order = 'legacy-first') {
    const srcBox = await makeWholeContainer(200)
    const whole = await makeWholeContainer(50)
    const box = await createEmptyBox()
    assert.equal((await fillReq(box, srcBox, key('fill'))).status, 200, '前置：放货失败')
    const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
    const wholeBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [whole]))[0].barcode
    const sale = await saleToTask(200)
    assert.ok((await pickScan(sale.taskId, sale.itemId, whole, wholeBarcode, 50, key('legacy'))).ok, '前置：整件拣货失败')
    assert.ok((await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 60, key('p1'))).ok, '前置：取 60 失败')
    assert.ok((await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 90, key('p2'))).ok, '前置：取 90 失败')
    const picks = await dbQuery(pool,
      "SELECT id, barcode FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id ASC", [box])
    assert.equal(picks.length, 2, '前置：应有两张取货码')

    assert.ok((await readyApi(sale.taskId)).ok, '前置：ready 失败')
    const [tk] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [sale.taskId])
    const binCode = tk.sorting_bin_code
    const sortedOrder = order === 'legacy-first'
      ? [{ itemId: sale.itemId, sortedQty: 50 }, { containerId: Number(picks[0].id), binCode }, { containerId: Number(picks[1].id), binCode }]
      : [{ containerId: Number(picks[0].id), binCode }, { containerId: Number(picks[1].id), binCode }, { itemId: sale.itemId, sortedQty: 50 }]
    // 分拣必须逐次提交（一次一张取货码），所以按顺序分三次
    for (let i = 0; i < sortedOrder.length; i++) {
      const r = await sortDoneRaw(sale.taskId, [sortedOrder[i]], key(`sort${i}`))
      assert.ok(r.ok, `前置：分拣第 ${i + 1} 步失败：${JSON.stringify(r.data).slice(0, 220)}`)
    }
    const [st] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [sale.taskId])
    assert.equal(Number(st.status), 4, '前置：任务应进入待复核(4)')

    // 真实复核：锁定集合 == 扫码集合（整件 I(50) + 两张取货码）
    for (const c of [{ id: whole, barcode: wholeBarcode }, { id: picks[0].id, barcode: picks[0].barcode }, { id: picks[1].id, barcode: picks[1].barcode }]) {
      const r = await checkScan(sale.taskId, c.barcode, key('chk'))
      assert.ok(r.ok, `前置：复核 ${c.barcode} 失败：${JSON.stringify(r.data).slice(0, 220)}`)
    }
    const [st2] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [sale.taskId])
    assert.equal(Number(st2.status), 5, '前置：任务应进入待打包(5)')
    const [item] = await dbQuery(pool, 'SELECT required_qty, picked_qty, checked_qty FROM warehouse_task_items WHERE id=?', [sale.itemId])
    assert.equal(Number(item.checked_qty), 200, '前置：checked 应为 200')
    return { ...sale, picks, wholeBarcode, boxBarcode }
  }

  try {
    // ── B3b-S1 标签默认整份入箱：不传数量即装该标签的**全部未装余量**（不是 1）──
    await check('扫取货标签天然整份入箱：两张标签（60 / 90）不传数量即各装各自整份', async () => {
      const t = await taskAtPacking()
      const pkg = await createPackageApi(t.taskId)
      assert.ok(pkg.ok, `建箱失败：${pkg.status} ${JSON.stringify(pkg.data).slice(0, 220)}`)
      const pkgId = Number(pkg.data.data.id)

      const r60 = await addByLabel(pkgId, t.picks[0].barcode, key('l1'))
      assert.ok(r60.ok, `标签入箱应成功：${r60.status} ${JSON.stringify(r60.data).slice(0, 250)}`)
      assert.equal(Number(r60.data.data.qty), 60, '不传数量时应整份装入该标签的未装余量 60')

      const r90 = await addByLabel(pkgId, t.picks[1].barcode, key('l2'))
      assert.ok(r90.ok, `第二张标签入箱应成功：${JSON.stringify(r90.data).slice(0, 250)}`)
      assert.equal(Number(r90.data.data.qty), 90, '第二张应整份装入 90')

      const rows = await pkgItems(pkgId)
      assert.equal(rows.length, 2, '两张标签各落一行（同商品不同来源不合并）')
      assert.equal(Number(rows[0].label_container_id), Number(t.picks[0].id), '第一行应记来源取货标签')
      assert.equal(Number(rows[0].qty), 60, '第一行数量应为 60')
      assert.equal(Number(rows[1].label_container_id), Number(t.picks[1].id), '第二行应记另一张取货标签')
      assert.equal(Number(rows[1].qty), 90, '第二行数量应为 90')
    })

    // ── B3b-S1b 真 150 标签：整份入箱 150 ────────────────────────────────────
    await check('150 的取货标签不传数量即装 150（整份，非默认 1）', async () => {
      // 单独造一张 150 的取货标签：整件 I(50) + 盒取 150 ⇒ picked=200，分拣/复核后停待打包
      const srcBox = await makeWholeContainer(150)
      const whole = await makeWholeContainer(50)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, srcBox, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const wholeBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [whole]))[0].barcode
      const sale = await saleToTask(200)
      assert.ok((await pickScan(sale.taskId, sale.itemId, whole, wholeBarcode, 50, key('legacy'))).ok, '前置：整件拣货失败')
      assert.ok((await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 150, key('p1'))).ok, '前置：取 150 失败')
      const [big] = await dbQuery(pool,
        "SELECT id, barcode FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1", [box])
      assert.ok((await readyApi(sale.taskId)).ok, '前置：ready 失败')
      const [tk] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [sale.taskId])
      assert.ok((await sortDoneRaw(sale.taskId, [{ itemId: sale.itemId, sortedQty: 50 }], key('s1'))).ok, '前置：旧码分拣失败')
      assert.ok((await sortDoneRaw(sale.taskId, [{ containerId: Number(big.id), binCode: tk.sorting_bin_code }], key('s2'))).ok, '前置：标签分拣失败')
      for (const bc of [wholeBarcode, big.barcode]) {
        assert.ok((await checkScan(sale.taskId, bc, key('chk'))).ok, `前置：复核 ${bc} 失败`)
      }
      const [st] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [sale.taskId])
      assert.equal(Number(st.status), 5, '前置：任务应进入待打包(5)')

      const pkgId = Number((await createPackageApi(sale.taskId)).data.data.id)
      const r = await addByLabel(pkgId, big.barcode, key('big'))
      assert.ok(r.ok, `150 标签入箱应成功：${r.status} ${JSON.stringify(r.data).slice(0, 250)}`)
      assert.equal(Number(r.data.data.qty), 150, '不传数量时应整份装入 150（不是默认 1）')
    })

    // ── B3b-S2 幂等：同键回放原结果不二次加量；同标签换新键重复被拒 ──────────────
    await check('标签入箱幂等：同键重放返回原结果且不二次加量；换新键重复装同一标签被拒', async () => {
      const t = await taskAtPacking()
      const pkgId = Number((await createPackageApi(t.taskId)).data.data.id)
      const k = key('l-replay')
      const first = await addByLabel(pkgId, t.picks[0].barcode, k)
      assert.ok(first.ok, `首次入箱失败：${JSON.stringify(first.data).slice(0, 220)}`)
      const before = await pkgItems(pkgId)

      // **丢响应后的「查回执」**：工人只能靠原键去 request-status 读回原结果，
      // 必须真实走这个 API（不能只验同键重放）。两种定位都要能查到：
      //   · base action —— 服务端 getScopedOperationRequestStatus 会用 LIKE 匹配**唯一** scoped 行；
      //   · scoped action —— 精确按 resource_id 过滤，**只接受原箱**。
      const statusOf = async (action) => {
        const r = await http.get(
          `/api/system/request-status/${encodeURIComponent(k)}?action=${encodeURIComponent(action)}`,
          { token, skipGlobalError: true },
        )
        assert.ok(r.ok, `查回执失败：${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
        return r.data?.data
      }

      const byBase = await statusOf('package.add')
      assert.equal(byBase?.status, 'success', 'base action 应能匹配到唯一 scoped 回执')
      assert.equal(Number(byBase?.data?.qty), Number(first.data.data.qty), '回执数据应为原数量')
      assert.equal(Number(byBase?.resourceId), Number(pkgId), '回执应绑定原箱')

      const byScoped = await statusOf(`package.add.${pkgId}`)
      assert.equal(byScoped?.status, 'success', 'scoped action 应能定位本箱回执')
      assert.equal(Number(byScoped?.resourceId), Number(pkgId), 'scoped 回执须绑定原箱')

      // 问**别的箱子**必须查不到：同键回执只属于原箱，不能被别的箱借走
      const otherPkgId = Number((await createPackageApi(t.taskId)).data.data.id)
      const wrongBox = await statusOf(`package.add.${otherPkgId}`)
      assert.equal(wrongBox?.status, 'not_found', '问别的箱子必须查不到（只接受原箱）')

      const replay = await addByLabel(pkgId, t.picks[0].barcode, k)
      assert.ok(replay.ok, `同键重放应返回原结果：${replay.status} ${JSON.stringify(replay.data).slice(0, 220)}`)
      assert.equal(Number(replay.data.data.qty), Number(first.data.data.qty), '重放应返回原数量')
      const after = await pkgItems(pkgId)
      assert.equal(after.length, before.length, '重放不得新增行')
      assert.equal(Number(after[0].qty), Number(before[0].qty), '重放不得二次加量')

      const dup = await addByLabel(pkgId, t.picks[0].barcode, key('l-dup'))
      assert.ok(!dup.ok, `换新键重复装同一标签必须拒绝（未装余量为 0），实际 ${dup.status} ${JSON.stringify(dup.data).slice(0, 200)}`)
      const afterDup = await pkgItems(pkgId)
      assert.equal(Number(afterDup[0].qty), Number(before[0].qty), '被拒不得加量')
    })

    // ── B3b-S3 同 SKU 旧 50 + 标签 60 + 90：两种顺序都不串份额 ────────────────
    await check('同 SKU 混合：旧 SKU 上限为 checked−Σ标签CHECK（尚未装的标签货也不被吞）', async () => {
      const t = await taskAtPacking()
      const pkgId = Number((await createPackageApi(t.taskId)).data.data.id)

      // 只装了标签 60，另一张标签 90 尚未装：旧 SKU 上限仍应是 50（不是 140）
      assert.ok((await addByLabel(pkgId, t.picks[0].barcode, key('m1'))).ok, '标签 60 入箱失败')
      const over = await addByCode(pkgId, product.code, 140, key('m2'))
      assert.ok(!over.ok, `旧 SKU 装 140 必须拒绝（上限 = 200−150 = 50），实际 ${over.status} ${JSON.stringify(over.data).slice(0, 200)}`)
      const okLegacy = await addByCode(pkgId, product.code, 50, key('m3'))
      assert.ok(okLegacy.ok, `旧 SKU 装 50 应放行：${JSON.stringify(okLegacy.data).slice(0, 220)}`)
      assert.ok((await addByLabel(pkgId, t.picks[1].barcode, key('m4'))).ok, '标签 90 入箱失败')

      const rows = await pkgItems(pkgId)
      const legacy = rows.find(r => r.label_container_id == null)
      const l60 = rows.find(r => Number(r.label_container_id) === Number(t.picks[0].id))
      const l90 = rows.find(r => Number(r.label_container_id) === Number(t.picks[1].id))
      assert.equal(Number(legacy?.qty), 50, '旧 SKU 行应为 50 且单独成行')
      assert.equal(Number(l60?.qty), 60, '标签 60 行应为 60')
      assert.equal(Number(l90?.qty), 90, '标签 90 行应为 90')
      const total = rows.reduce((s, r) => s + Number(r.qty), 0)
      assert.equal(total, 200, '合计应为 200（= checked）')

      // **另一种顺序**：旧 SKU 先装 50，再装两张标签。上限口径与顺序无关，
      // 但必须真的跑过——不能只在注释里声称"两种顺序"。
      const t2 = await taskAtPacking()
      const pkg2 = Number((await createPackageApi(t2.taskId)).data.data.id)
      assert.ok((await addByCode(pkg2, product.code, 50, key('n1'))).ok, '旧 SKU 先装 50 应放行')
      assert.ok((await addByLabel(pkg2, t2.picks[0].barcode, key('n2'))).ok, '随后标签 60 应放行')
      assert.ok((await addByLabel(pkg2, t2.picks[1].barcode, key('n3'))).ok, '随后标签 90 应放行')
      const rows2 = await pkgItems(pkg2)
      assert.equal(rows2.length, 3, '旧 SKU 与两张标签各成一行')
      assert.equal(rows2.reduce((s, r) => s + Number(r.qty), 0), 200, '反序后合计同样为 200')
      const legacy2 = rows2.find(r => r.label_container_id == null)
      assert.equal(Number(legacy2?.qty), 50, '旧 SKU 行仍应为 50（不被标签吞）')
    })

    // ── B3b-S4 部分装箱 + 回收不串份额 ──────────────────────────────────────
    await check('标签只装一部分后再装余量；remove 后配额释放且不串到旧 SKU', async () => {
      const t = await taskAtPacking()
      const pkgId = Number((await createPackageApi(t.taskId)).data.data.id)

      const part = await addByLabel(pkgId, t.picks[0].barcode, key('p1'), 20)
      assert.ok(part.ok, `标签装 20 应成功：${JSON.stringify(part.data).slice(0, 220)}`)
      assert.equal(Number(part.data.data.qty), 20, '应只装 20')

      // 该标签仍有余量 40 ⇒ 整份再装应装 40
      const rest = await addByLabel(pkgId, t.picks[0].barcode, key('p2'))
      assert.ok(rest.ok, `标签余量入箱应成功：${JSON.stringify(rest.data).slice(0, 220)}`)
      const rows1 = await pkgItems(pkgId)
      assert.equal(Number(rows1[0].qty), 60, '该标签行应累计到 60')

      // 移出 10 ⇒ 该标签行回到 50，未装余量回到 10；旧 SKU 上限不受影响
      const rm = await removeItemApi(pkgId, Number(rows1[0].id), 10, key('p3'))
      assert.ok(rm.ok, `移出应成功：${JSON.stringify(rm.data).slice(0, 220)}`)
      const rows2 = await pkgItems(pkgId)
      assert.equal(Number(rows2[0].qty), 50, '移出后该标签行应为 50')

      const overLabel = await addByLabel(pkgId, t.picks[0].barcode, key('p4'), 11)
      assert.ok(!overLabel.ok, `标签超未装余量必须拒绝，实际 ${overLabel.status} ${JSON.stringify(overLabel.data).slice(0, 200)}`)
      const okLabel = await addByLabel(pkgId, t.picks[0].barcode, key('p5'), 10)
      assert.ok(okLabel.ok, `标签装回余量 10 应放行：${JSON.stringify(okLabel.data).slice(0, 220)}`)

      const legacyOk = await addByCode(pkgId, product.code, 50, key('p6'))
      assert.ok(legacyOk.ok, `旧 SKU 装 50 仍应放行（标签额度互不占用）：${JSON.stringify(legacyOk.data).slice(0, 220)}`)
    })

    // ── B3b-S5 作废回收后可合法重装 ─────────────────────────────────────────
    await check('作废箱子后配额回收：同一标签可在新箱重新装入', async () => {
      const t = await taskAtPacking()
      const pkgId = Number((await createPackageApi(t.taskId)).data.data.id)
      assert.ok((await addByLabel(pkgId, t.picks[0].barcode, key('v1'))).ok, '标签入箱失败')
      assert.equal(Number((await pkgRow(pkgId)).status), 1, '前置：箱应为打包中')

      const v = await voidPkgApi(pkgId)
      assert.ok(v.ok, `作废应成功：${JSON.stringify(v.data).slice(0, 220)}`)
      assert.equal(Number((await pkgRow(pkgId)).status), 3, '箱应已作废')

      const pkg2 = Number((await createPackageApi(t.taskId)).data.data.id)
      const again = await addByLabel(pkg2, t.picks[0].barcode, key('v2'))
      assert.ok(again.ok, `作废后同一标签应能重新装入新箱：${again.status} ${JSON.stringify(again.data).slice(0, 220)}`)
      assert.equal(Number(again.data.data.qty), 60, '重新装入应为整份 60')
    })

    // ── B3b-S6 越权 / 阶段闸（两者**分开**断言，不互相冒充）──────────────────
    await check('他任务标签不得装箱；任务未到待打包时建箱即被阶段闸拒绝', async () => {
      const a = await taskAtPacking()
      const b = await taskAtPacking()
      const pkgA = Number((await createPackageApi(a.taskId)).data.data.id)

      // ① 底层归属闸：他任务的标签
      const wrong = await addByLabel(pkgA, b.picks[0].barcode, key('w1'))
      assert.ok(!wrong.ok, `他任务标签必须拒绝，实际 ${wrong.status} ${JSON.stringify(wrong.data).slice(0, 220)}`)
      assert.match(String(wrong.data?.message || ''), /本任务|取货标签/, '拒绝理由应指向标签归属')
      assert.equal((await pkgItems(pkgA)).length, 0, '被拒不得落行')

      // ② 阶段闸：任务停在待复核(4) 时**建箱本身就拒**。
      //    这里只证明「阶段闸生效」——**不能**拿它当「未复核容器不得装箱」的证据（那是另一道闸，
      //    在完整链下不可达，见交接的未覆盖项）。
      const srcBox = await makeWholeContainer(40)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, srcBox, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const c = await saleToTask(40)
      assert.ok((await pickScan(c.taskId, c.itemId, box, boxBarcode, 40, key('pk'))).ok, '前置：取货失败')
      const [unchecked] = await dbQuery(pool,
        "SELECT id FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1", [box])
      assert.ok((await readyApi(c.taskId)).ok, '前置：ready 失败')
      const [tk2] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [c.taskId])
      assert.ok((await sortDoneRaw(c.taskId, [{ containerId: Number(unchecked.id), binCode: tk2.sorting_bin_code }], key('sd'))).ok, '前置：分拣失败')
      const [st4] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [c.taskId])
      assert.equal(Number(st4.status), 4, '前置：任务应停在待复核(4)')

      const earlyPkg = await createPackageApi(c.taskId)
      assert.ok(!earlyPkg.ok, `待复核任务不得建箱，实际 ${earlyPkg.status} ${JSON.stringify(earlyPkg.data).slice(0, 200)}`)
      assert.equal(earlyPkg.data?.data ?? null, null, '阶段拒绝不得返回箱 id')
    })

    // ── B3b-S7 取消 / 改单挂起时挡新写 ──────────────────────────────────────
    await check('任务取消后不得继续装箱（既有保护不弱化）', async () => {
      const t = await taskAtPacking()
      const pkgId = Number((await createPackageApi(t.taskId)).data.data.id)
      assert.equal((await http.post(`/api/sale/${t.saleId}/cancel`, { token })).status, 200, '前置：取消销售单失败')
      const r = await addByLabel(pkgId, t.picks[0].barcode, key('c1'))
      assert.ok(!r.ok, `已取消任务不得装箱，实际 ${r.status} ${JSON.stringify(r.data).slice(0, 220)}`)
      assert.equal((await pkgItems(pkgId)).length, 0, '被拒不得落行')
    })
  } finally {
    let cleaned = 0
    for (const { saleId, taskId } of createdSales) {
      try {
        if (taskId == null) {
          const c = await http.post(`/api/sale/${saleId}/cancel`, { token })
          if (!c.ok) { failed++; console.error(`[FAIL] 收尾：cancel sale ${saleId}（无任务）-> ${c.status}`) }
          else cleaned++
          continue
        }
        const rows = await dbQuery(pool, 'SELECT status, cancel_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
        const tk = rows[0]
        if (!tk) { failed++; console.error(`[FAIL] 收尾：task ${taskId} 不存在（sale ${saleId}）`); continue }
        const locked = await dbQuery(pool, 'SELECT id, barcode FROM inventory_containers WHERE locked_by_task_id=?', [taskId])
        if (Number(tk.status) === 8 && locked.length === 0) { cleaned++; continue }

        if (Number(tk.status) !== 8 && !tk.cancel_requested_at) {
          const c = await http.post(`/api/sale/${saleId}/cancel`, { token })
          if (!c.ok) { failed++; console.error(`[FAIL] 收尾：cancel sale ${saleId} -> ${c.status}`); continue }
        }
        const d = await http.get(`/api/warehouse-tasks/${taskId}/cancel-return-detail`, { token })
        if (!d.ok) { failed++; console.error(`[FAIL] 收尾：cancel-return-detail task ${taskId} -> ${d.status}`); continue }
        for (const c of locked) {
          const r = await http.post('/api/scan-logs/cancel-return', {
            token, headers: pdaHeaders(),
            json: { taskId, containerId: Number(c.id), barcode: c.barcode, locationId: location.id },
          })
          if (!r.ok) {
            failed++
            console.error(`[FAIL] 收尾：return task ${taskId} container ${c.barcode} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`)
          }
        }
        const t2rows = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
        const leftRows = await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_containers WHERE locked_by_task_id=?', [taskId])
        const st = Number(t2rows[0]?.status)
        const left = Number(leftRows[0]?.c ?? -1)
        if (st !== 8 || left !== 0) {
          failed++
          console.error(`[FAIL] 收尾核对：task ${taskId} status=${st} 剩余锁=${left}`)
        } else {
          cleaned++
        }
      } catch (e) {
        failed++
        console.error(`[FAIL] 收尾 sale ${saleId}/task ${taskId} 异常：${e.message}`)
      }
    }
    console.log(`[INFO] 自建销售夹具 ${createdSales.length} 笔，收尾核对通过 ${cleaned} 笔，失败 ${createdSales.length - cleaned} 笔`)

    for (const binId of createdBins) {
      try {
        const r = await http.delete(`/api/sorting-bins/${binId}`, { token })
        if (!r.ok) console.warn(`[WARN] 收尾：自建分拣格 ${binId} 未删除、保留原状：${r.status} ${JSON.stringify(r.data).slice(0, 120)}`)
      } catch (e) {
        console.warn(`[WARN] 收尾：自建分拣格 ${binId} 删除请求异常、保留原状：${e.message}`)
      }
    }

    try { await close() } catch (e) { failed++; console.error(`[FAIL] 关闭测试服务/连接池失败：${e.message}`) }
    try { await require('../backend/src/config/db').pool.end() } catch (e) { failed++; console.error(`[FAIL] 关闭全局连接池失败：${e.message}`) }
  }

  console.log(`\n${'='.repeat(50)}\n  ${passed} passed, ${failed} failed\n${'='.repeat(50)}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error('套件异常终止：', e); process.exitCode = 1 })
