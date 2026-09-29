'use strict'

/**
 * 批 B3a · 取货码下游链：**分拣**（取货码 → 真实 `sort-done` 推进链）与**复核**（真实 CHECK 扫码闭合）。
 *
 * 断言口径：HTTP 状态码 + **数据库事实**（`warehouse_task_items.sorted_qty`/`checked_qty`、
 * `sorting_bin_items` 记录、任务状态迁移、`scan_logs` 复核行、容器锁定）。任一项失败即 `process.exitCode = 1`。
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
  const ctx = await prepareSmokeContext({ requestTimeoutMs: 30000 })
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

  /** 真实链造整件（采购→收货→上架） */
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

  /** 本套件自建的销售夹具：**逐笔登记**，结束时按 ID 合法取消/归还（不靠前缀事后全扫） */
  const createdSales = []
  /** 本套件自建的分拣格（收尾只删**自己建的**空闲格） */
  const createdBins = []

  /** 真实链造「本仓的拣货任务」：销售单 → 占库 → 发货（生成任务）
   *  分拣格在**进入拣货(2)时**由 on-enter 动作分配，所以必须先备好空闲格，否则任务永远无格可用 */
  async function saleToTask(qty) {
    await ensureFreeBin()
    const sale = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('pb-down'),
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

  const readyApi = (taskId) =>
    http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: pdaHeaders() })

  const sortDoneRaw = (taskId, items, k) =>
    http.put(`/api/warehouse-tasks/${taskId}/sort-done`, {
      token,
      headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) },
      json: { items },
    })

  const checkScan = (taskId, barcode, k) =>
    http.post('/api/scan-logs/check', {
      token,
      headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) },
      json: { taskId, barcode },
    })

  /** 本仓必须有一个空闲分拣格才能走到分拣链；没有就自建一个（收尾只删自己建的） */
  async function ensureFreeBin() {
    const list = await http.get(`/api/sorting-bins/warehouse/${warehouse.id}`, { token })
    const free = (list.data?.data ?? []).find(b => Number(b.status) === 1)
    if (free) return free
    const code = `PB${String(randomRef('B')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`
    const created = await http.post('/api/sorting-bins', {
      token, json: { code, warehouseId: Number(warehouse.id), remark: 'pb-downstream' },
    })
    assert.ok(created.ok, `自建分拣格失败：${JSON.stringify(created.data).slice(0, 200)}`)
    const id = Number(created.data.data.id)
    createdBins.push(id)
    return { id, code, status: 1 }
  }

  /** 走真实链把任务推到「待分拣」(3)：造整件 → 盒 → 销售任务 → 拣货 → ready */
  async function taskAtSorting(qty) {
    const src = await makeWholeContainer(qty)
    const box = await createEmptyBox()
    assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
    const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
    const sale = await saleToTask(qty)
    const picked = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, qty, key('pick'))
    assert.ok(picked.ok, `前置：扫盒取货失败：${JSON.stringify(picked.data).slice(0, 220)}`)
    const [newI] = await dbQuery(pool,
      "SELECT id, barcode FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1",
      [box])
    assert.ok(newI, '前置：应生成新 I')
    const rd = await readyApi(sale.taskId)
    assert.ok(rd.ok, `前置：ready 失败：${JSON.stringify(rd.data).slice(0, 220)}`)
    const [tk] = await dbQuery(pool, 'SELECT status, sorting_bin_id, sorting_bin_code FROM warehouse_tasks WHERE id=?', [sale.taskId])
    assert.equal(Number(tk.status), 3, '前置：任务应进入待分拣(3)')
    assert.ok(tk.sorting_bin_id, '前置：任务应已分配分拣格')
    return { ...sale, box, boxBarcode, newI, binCode: tk.sorting_bin_code }
  }

  /** 再往前一步到「待复核」(4)：该任务靠**扫盒取货**，旧码份额为 0，必须用取货码形态分拣 */
  async function taskAtChecking(qty) {
    const t = await taskAtSorting(qty)
    const sd = await sortDoneRaw(t.taskId, [{ containerId: Number(t.newI.id), binCode: t.binCode }], key('sort'))
    assert.ok(sd.ok, `前置：sort-done 失败：${JSON.stringify(sd.data).slice(0, 220)}`)
    const [tk2] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
    assert.equal(Number(tk2.status), 4, '前置：任务应进入待复核(4)')
    return t
  }

  /** 纯旧商品码路径的任务：整件 I 直接拣（无盒取货 ⇒ A=0），停在待分拣(3) */
  async function legacyTaskAtSorting(qty) {
    const whole = await makeWholeContainer(qty)
    const wholeBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [whole]))[0].barcode
    const sale = await saleToTask(qty)
    assert.ok((await pickScan(sale.taskId, sale.itemId, whole, wholeBarcode, qty, key('legacy'))).ok, '前置：整件拣货失败')
    assert.ok((await readyApi(sale.taskId)).ok, '前置：ready 失败')
    const [tk] = await dbQuery(pool, 'SELECT status, sorting_bin_id FROM warehouse_tasks WHERE id=?', [sale.taskId])
    assert.equal(Number(tk.status), 3, '前置：任务应进入待分拣(3)')
    assert.ok(tk.sorting_bin_id, '前置：任务应已分配分拣格')
    return { sale }
  }

  /**
   * 混合来源夹具：整件 I(50) 走**旧商品码**路径（PICK 行 source_container_id 为 NULL）
   * + 盒取两张取货码(60/90) ⇒ picked=200，停在待分拣(3)。
   */
  async function mixedTaskFixture() {
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
    const [pickedRow] = await dbQuery(pool, 'SELECT picked_qty FROM warehouse_task_items WHERE id=?', [sale.itemId])
    assert.equal(Number(pickedRow.picked_qty), 200, '前置：picked 应为 200')
    const picks = await dbQuery(pool,
      "SELECT id FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id ASC", [box])
    assert.equal(picks.length, 2, '前置：应有两张取货码')
    assert.ok((await readyApi(sale.taskId)).ok, '前置：ready 失败')
    const [tk] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [sale.taskId])
    return { sale, picks, binCode: tk.sorting_bin_code }
  }

  try {
    // ── B3a-R1 取货码精确解析 ───────────────────────────────────────────────
    await check('扫取货码（新 I）应精确定位自身任务/明细/格位与 PICK 有效量，不得回退他 SKU', async () => {
      // 分拣链解析面向**进行中**(2/3)的任务，所以夹具必须停在待分拣(3)，不能用已完成分拣的 4
      const t = await taskAtSorting(150)
      const r = await http.get(`/api/sorting-bins/scan?code=${encodeURIComponent(t.newI.barcode)}`, { token })
      assert.ok(r.ok, `查取货码失败：${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
      const d = r.data.data
      assert.ok(d, '扫取货码必须有解析结果（当前只会按商品码匹配，取货码解析不到）')
      assert.equal(Number(d.taskId), t.taskId, '取货码应精确定位到本任务')
      assert.equal(Number(d.itemId), t.itemId, '取货码应精确定位到本任务明细')
      assert.equal(Number(d.containerId), Number(t.newI.id), '取货码应回报自身容器 id')
      assert.equal(Number(d.qty), 150, '取货码的 PICK 有效量应为 150')
    })

    // ── B3a-R2 分拣原键重放（状态规则 vs replay 的先后）────────────────────
    await check('分拣原键重放①：纯旧商品码路径，完成(3→4)后重放返回原回执且不重复推进', async () => {
      // 必须用**真的**纯旧商品码任务（整件 I 直接拣，A=0）。扫盒生成的取货码会让
      // 旧码上限变成 picked−A=0，那是另一条路径，不能用它验证旧码重放。
      const t = await legacyTaskAtSorting(120)
      const taskId = t.sale.taskId
      const itemId = t.sale.itemId
      const k = key('sort-replay-old')
      const items = [{ itemId, sortedQty: 120 }]
      const first = await sortDoneRaw(taskId, items, k)
      assert.ok(first.ok, `首次 sort-done 应成功：${first.status} ${JSON.stringify(first.data).slice(0, 200)}`)
      const before = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [itemId])

      const replay = await sortDoneRaw(taskId, items, k)
      assert.ok(replay.ok, `原键重放应返回原成功结果（当前会被状态规则挡在 replay 之前）：${replay.status} ${JSON.stringify(replay.data).slice(0, 200)}`)
      assert.equal(Boolean(replay.data?.data?.allSorted), true, '重放应返回原回执 allSorted=true')
      const after = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [itemId])
      assert.equal(Number(after[0].sorted_qty), Number(before[0].sorted_qty), '重放不得重复累加 sorted_qty')
    })

    // ── B3a-R2b 新取货码路径的原键重放 ─────────────────────────────────────
    await check('分拣原键重放②：新取货码路径，完成(3→4)后重放返回原回执、不重复推进、不新增作业记录', async () => {
      const t = await taskAtSorting(80)
      const k = key('sort-replay-pick')
      const items = [{ containerId: Number(t.newI.id), binCode: t.binCode }]
      const first = await sortDoneRaw(t.taskId, items, k)
      assert.ok(first.ok, `取货码首次分拣应成功：${first.status} ${JSON.stringify(first.data).slice(0, 220)}`)
      const before = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      const cntBefore = Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM sorting_bin_items WHERE task_id=?', [t.taskId]))[0].c)

      const replay = await sortDoneRaw(t.taskId, items, k)
      assert.ok(replay.ok, `取货码原键重放应返回原成功结果：${replay.status} ${JSON.stringify(replay.data).slice(0, 220)}`)
      assert.equal(Boolean(replay.data?.data?.allSorted), true, '重放应返回原回执 allSorted=true')
      const after = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      assert.equal(Number(after[0].sorted_qty), Number(before[0].sorted_qty), '重放不得重复累加 sorted_qty')
      const cntAfter = Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM sorting_bin_items WHERE task_id=?', [t.taskId]))[0].c)
      assert.equal(cntAfter, cntBefore, '重放不得新增分拣作业记录')
    })

    // ── B3a-R3 复核：设备仓不符必须拒绝（service 直调，沿用批 A 口径）────────
    await check('复核扫码：PDA 设备仓 ≠ 任务仓必须拒绝（含首次）', async () => {
      const t = await taskAtChecking(30)
      const svc = require('../backend/src/modules/scan-logs/scan-logs.service')
      await assert.rejects(
        () => svc.createCheckScanLog({
          taskId: t.taskId, barcode: t.newI.barcode,
          operatorId: 1, operatorName: 'smoke_admin',
          requestKey: key('chk-wh'), scopeWarehouseIds: null, pdaWarehouseId: 999999,
        }),
        (e) => Number(e.statusCode) === 403 && /仓库/.test(String(e.message || '')),
        '复核扫码当前不校验 PDA 设备仓，跨仓设备可复核异仓任务',
      )
    })

    // ── B3a-R4 复核：范围校验必须覆盖重放 ──────────────────────────────────
    await check('复核扫码：限仓范围校验必须覆盖重放（同键重放不得绕过）', async () => {
      const t = await taskAtChecking(30)
      const svc = require('../backend/src/modules/scan-logs/scan-logs.service')
      const k = key('chk-scope')
      // 首次：合法范围（不限仓）成功，占用该 requestKey
      const first = await svc.createCheckScanLog({
        taskId: t.taskId, barcode: t.newI.barcode,
        operatorId: 1, operatorName: 'smoke_admin',
        requestKey: k, scopeWarehouseIds: null,
      })
      assert.ok(first && first.id, '首次复核应成功')
      // 重放：换成越权范围，必须仍被拒绝（当前直接返回原回执，绕过范围校验）
      await assert.rejects(
        () => svc.createCheckScanLog({
          taskId: t.taskId, barcode: t.newI.barcode,
          operatorId: 1, operatorName: 'smoke_admin',
          requestKey: k, scopeWarehouseIds: [999999],
        }),
        (e) => Number(e.statusCode) === 403,
        '复核重放当前不校验范围，越权范围可拿到原回执',
      )
    })

    // ── B3a-S1 取货码走真实 sort-done 推进链（3→4 + 作业记录）───────────────
    await check('取货码经真实 sort-done：任务 3→4、sorted_qty 推进、落一条 sorting_bin_items', async () => {
      const t = await taskAtSorting(90)
      const r = await sortDoneRaw(t.taskId, [{ containerId: Number(t.newI.id), binCode: t.binCode }], key('sort-pickcode'))
      assert.ok(r.ok, `取货码分拣应成功：${r.status} ${JSON.stringify(r.data).slice(0, 250)}`)

      const [after] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      assert.equal(Number(after.status), 4, '取货码分拣满量后任务应推进到待复核(4)')
      const [item] = await dbQuery(pool, 'SELECT sorted_qty, picked_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      assert.equal(Number(item.sorted_qty), 90, 'sorted_qty 应推进为该取货标签的份额')
      assert.equal(Number(item.picked_qty), 90, 'picked_qty 不应被分拣改动')
      const sbi = await dbQuery(pool, 'SELECT bin_id, task_id, container_id, product_id, qty FROM sorting_bin_items WHERE task_id=?', [t.taskId])
      assert.equal(sbi.length, 1, '应落且只落一条分拣作业记录')
      assert.equal(Number(sbi[0].container_id), Number(t.newI.id), '作业记录应指向该取货码容器')
      assert.equal(Number(sbi[0].qty), 90, '作业记录数量应为本次份额')
    })

    // ── B3a-S2 两张取货码连续分拣：sorted_qty 为两者之和（不被第二张抹掉）──
    await check('同一明细连续两张取货码：sorted_qty 为两张之和，而非第二张的值', async () => {
      const src = await makeWholeContainer(200)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(150)
      const p1 = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 60, key('p1'))
      assert.ok(p1.ok, `第一次取货失败：${JSON.stringify(p1.data).slice(0, 220)}`)
      const p2 = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 90, key('p2'))
      assert.ok(p2.ok, `第二次取货失败：${JSON.stringify(p2.data).slice(0, 220)}`)
      const picks = await dbQuery(pool,
        "SELECT id, barcode, remaining_qty FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id ASC",
        [box])
      assert.equal(picks.length, 2, '前置：应生成两张取货码')
      assert.ok((await readyApi(sale.taskId)).ok, '前置：ready 失败')
      const [tk] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [sale.taskId])

      const r1 = await sortDoneRaw(sale.taskId, [{ containerId: Number(picks[0].id), binCode: tk.sorting_bin_code }], key('s1'))
      assert.ok(r1.ok, `第一张分拣失败：${JSON.stringify(r1.data).slice(0, 220)}`)
      const mid = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [sale.itemId])
      assert.equal(Number(mid[0].sorted_qty), 60, '第一张后 sorted_qty 应为 60')

      const r2 = await sortDoneRaw(sale.taskId, [{ containerId: Number(picks[1].id), binCode: tk.sorting_bin_code }], key('s2'))
      assert.ok(r2.ok, `第二张分拣失败：${JSON.stringify(r2.data).slice(0, 220)}`)
      const after = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [sale.itemId])
      assert.equal(Number(after[0].sorted_qty), 150, '两张后 sorted_qty 应为两张之和 150（不得被第二张的 90 抹掉）')
      const sbi = await dbQuery(pool, 'SELECT COUNT(*) c FROM sorting_bin_items WHERE task_id=?', [sale.taskId])
      assert.equal(Number(sbi[0].c), 2, '应落两条分拣作业记录')
    })

    // ── B3a-S3 反向：他任务取货码必须拒绝 ──────────────────────────────────
    await check('他任务的取货码不得用于本任务分拣（拒绝且零进度副作用）', async () => {
      const a = await taskAtSorting(40)
      const b = await taskAtSorting(40)
      const bPick = await dbQuery(pool,
        "SELECT id FROM inventory_containers WHERE locked_by_task_id=? AND source_ref_type='plastic_box_pick'",
        [b.taskId])
      assert.ok(bPick.length, '前置：b 任务应有一张取货码')
      const before = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [a.itemId])
      const r = await sortDoneRaw(a.taskId, [{ containerId: Number(bPick[0].id), binCode: a.binCode }], key('wrong-task'))
      assert.ok(!r.ok, `他任务取货码必须拒绝，实际 ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
      assert.match(String(r.data?.message || ''), /取货码/, '拒绝理由应指向取货码归属，而非"分拣明细无效"')
      const after = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [a.itemId])
      assert.equal(Number(after[0].sorted_qty), Number(before[0].sorted_qty), '被拒不得产生进度副作用')
    })

    // ── B3a-S4 反向：放错格（实扫格 ≠ 任务格）必须拒绝 ─────────────────────
    await check('实扫分拣格与任务占用格不一致必须拒绝（不能只靠前端比对）', async () => {
      const t = await taskAtSorting(35)
      const before = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      const r = await sortDoneRaw(t.taskId, [{ containerId: Number(t.newI.id), binCode: 'WRONG-BIN-9' }], key('wrong-bin'))
      assert.ok(!r.ok, `放错格必须拒绝，实际 ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
      assert.match(String(r.data?.message || ''), /格/, '拒绝理由应指向分拣格不一致')
      const after = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      assert.equal(Number(after[0].sorted_qty), Number(before[0].sorted_qty), '被拒不得产生进度副作用')
    })

    // ── B3a-S5 真实复核扫码闭合：扫新 I → checked_qty → 自动 checkDone(4→5) ──
    await check('真实复核扫码：扫新 I 落 CHECK 行、checked_qty 累加、全量后自动进入待打包(5)', async () => {
      const t = await taskAtChecking(70)
      const r = await checkScan(t.taskId, t.newI.barcode, key('chk'))
      assert.ok(r.ok, `复核扫码应成功：${r.status} ${JSON.stringify(r.data).slice(0, 250)}`)
      assert.equal(Boolean(r.data?.data?.allChecked), true, '该明细复核满量后应回报 allChecked')
      const [sl] = await dbQuery(pool,
        'SELECT container_id, item_id, qty, scan_purpose FROM scan_logs WHERE task_id=? AND scan_purpose=2 ORDER BY id DESC LIMIT 1',
        [t.taskId])
      assert.ok(sl, '应落一条复核扫码记录')
      assert.equal(Number(sl.container_id), Number(t.newI.id), '复核行应指向该取货码容器')
      assert.equal(Number(sl.qty), 70, '复核量应等于该容器拣货量')
      const [item] = await dbQuery(pool, 'SELECT checked_qty, picked_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      assert.equal(Number(item.checked_qty), Number(item.picked_qty), 'checked_qty 应闭合到 picked_qty')
      const [tk] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      assert.equal(Number(tk.status), 5, '最后一条复核扫码应自动推进到待打包(5)')
    })

    // ── B3a-S6 复核同键重放 / 新键重复 ────────────────────────────────────
    await check('复核同键重放返回原回执；新键重复扫同一取货码被拒', async () => {
      const t = await taskAtChecking(100)
      const k = key('chk-replay')
      const first = await checkScan(t.taskId, t.newI.barcode, k)
      assert.ok(first.ok, `首次复核应成功：${first.status} ${JSON.stringify(first.data).slice(0, 220)}`)
      const cnt = async () => Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM scan_logs WHERE task_id=? AND scan_purpose=2', [t.taskId]))[0].c)
      const n1 = await cnt()

      const replay = await checkScan(t.taskId, t.newI.barcode, k)
      assert.ok(replay.ok, `同键重放应返回原回执：${replay.status} ${JSON.stringify(replay.data).slice(0, 220)}`)
      assert.equal(await cnt(), n1, '同键重放不得新增复核扫码记录')

      const dup = await checkScan(t.taskId, t.newI.barcode, key('chk-dup'))
      assert.ok(!dup.ok, `新键重复扫同一取货码应被拒（已复核完成），实际 ${dup.status} ${JSON.stringify(dup.data).slice(0, 200)}`)
    })

    // ── B3a-S7 混合来源：两种顺序都逐步累加、互不覆盖，且都必须经标签收满 ────
    await check('混合来源两种顺序（旧50→标60→标90 / 标60→标90→旧50）：sorted_qty 逐步累加，未扫完标签不得完成', async () => {
      const sortedOf = async (itemId) =>
        Number((await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [itemId]))[0].sorted_qty)
      const statusOf = async (taskId) =>
        Number((await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId]))[0].status)

      // ── 顺序一：旧商品码 50 → 标签 60 → 标签 90 ──
      const a = await mixedTaskFixture()
      const a1 = await sortDoneRaw(a.sale.taskId, [{ itemId: a.sale.itemId, sortedQty: 50 }], key('m1'))
      assert.ok(a1.ok, `旧码报 50（=picked-A）应放行：${a1.status} ${JSON.stringify(a1.data).slice(0, 220)}`)
      assert.equal(await sortedOf(a.sale.itemId), 50, '旧码 50 后 sorted_qty 应为 50')
      assert.notEqual(await statusOf(a.sale.taskId), 4, '标签未扫不得分拣完成')

      const a2 = await sortDoneRaw(a.sale.taskId, [{ containerId: Number(a.picks[0].id), binCode: a.binCode }], key('m2'))
      assert.ok(a2.ok, `标签 60 分拣失败：${JSON.stringify(a2.data).slice(0, 220)}`)
      assert.equal(await sortedOf(a.sale.itemId), 110, '旧50+标60 应为 110（累加不覆盖）')
      assert.notEqual(await statusOf(a.sale.taskId), 4, '还剩标签 90 未扫，不得分拣完成')

      const a3 = await sortDoneRaw(a.sale.taskId, [{ containerId: Number(a.picks[1].id), binCode: a.binCode }], key('m3'))
      assert.ok(a3.ok, `标签 90 分拣失败：${JSON.stringify(a3.data).slice(0, 220)}`)
      assert.equal(await sortedOf(a.sale.itemId), 200, '三来源累计应恰好 200')
      assert.equal(await statusOf(a.sale.taskId), 4, '标签全部扫完后才推进到待复核(4)')

      // ── 顺序二：标签 60 → 标签 90 → 旧商品码 50 ──
      const b = await mixedTaskFixture()
      const b1 = await sortDoneRaw(b.sale.taskId, [{ containerId: Number(b.picks[0].id), binCode: b.binCode }], key('n1'))
      assert.ok(b1.ok, `标签 60 分拣失败：${JSON.stringify(b1.data).slice(0, 220)}`)
      assert.equal(await sortedOf(b.sale.itemId), 60, '标签 60 后应为 60')
      const b2 = await sortDoneRaw(b.sale.taskId, [{ containerId: Number(b.picks[1].id), binCode: b.binCode }], key('n2'))
      assert.ok(b2.ok, `标签 90 分拣失败：${JSON.stringify(b2.data).slice(0, 220)}`)
      assert.equal(await sortedOf(b.sale.itemId), 150, '两张标签后应为 150')
      assert.notEqual(await statusOf(b.sale.taskId), 4, '旧码份额 50 尚未上报，不得分拣完成')
      const b3 = await sortDoneRaw(b.sale.taskId, [{ itemId: b.sale.itemId, sortedQty: 50 }], key('n3'))
      assert.ok(b3.ok, `旧码报 50 应放行：${JSON.stringify(b3.data).slice(0, 220)}`)
      assert.equal(await sortedOf(b.sale.itemId), 200, '150+50 应恰好 200')
      assert.equal(await statusOf(b.sale.taskId), 4, '收满后应推进到待复核(4)')

      const sbi = await dbQuery(pool, 'SELECT COUNT(*) c FROM sorting_bin_items WHERE task_id=?', [a.sale.taskId])
      assert.equal(Number(sbi[0].c), 2, '取货码作业记录只记标签（旧商品码路径不落本表）')
    })

    // ── B3a-S8 反向：旧码上限是 picked − A（含未分拣标签），不是 picked − C ──
    await check('反向：未扫任何标签时旧码最多报 picked−A（A 含未分拣标签），报满量被拒', async () => {
      const t = await mixedTaskFixture()
      const sortedOf = async () =>
        Number((await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.sale.itemId]))[0].sorted_qty)

      // A = 150（两张标签的取货量，尚未分拣 ⇒ C = 0）⇒ 旧码上限 = 200-150 = 50
      const over = await sortDoneRaw(t.sale.taskId, [{ itemId: t.sale.itemId, sortedQty: 200 }], key('r1'))
      assert.ok(!over.ok, `未扫标签时旧码报满量必须拒绝（上限 picked−A=50），实际 ${over.status} ${JSON.stringify(over.data).slice(0, 200)}`)
      assert.match(String(over.data?.message || ''), /取货标签已占/, '拒绝理由应指向被标签占走的份额')
      assert.equal(await sortedOf(), 0, '被拒不得产生进度副作用')

      const ok = await sortDoneRaw(t.sale.taskId, [{ itemId: t.sale.itemId, sortedQty: 50 }], key('r2'))
      assert.ok(ok.ok, `旧码报 50（恰为 picked−A）应放行：${ok.status} ${JSON.stringify(ok.data).slice(0, 220)}`)
      assert.equal(await sortedOf(), 50, '旧码份额应为 50')
      const [st] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.sale.taskId])
      assert.notEqual(Number(st.status), 4, '标签未扫，不得分拣完成')
    })

    // ── B3a-S9 整任务完成（items=null）同样按份额，不得恒等式填满 ──────────
    await check('整任务完成(items=null)按份额写：未扫标签时只能写 (picked−A)+C，不得直接填满', async () => {
      const t = await mixedTaskFixture()
      const sortedOf = async () =>
        Number((await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.sale.itemId]))[0].sorted_qty)

      // A=150、C=0 ⇒ 只能写 50，任务不得推进
      const nu = await sortDoneRaw(t.sale.taskId, null, key('nu1'))
      assert.ok(nu.ok, `整任务完成应成功：${nu.status} ${JSON.stringify(nu.data).slice(0, 220)}`)
      assert.equal(await sortedOf(), 50, '未扫标签时整任务完成只能写 (picked−A)+C = 50，不得填满 200')
      let [st] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.sale.taskId])
      assert.notEqual(Number(st.status), 4, '标签未扫，整任务完成不得推进')

      // 扫完两张标签后 C=150 ⇒ 50+150 = 200 才推进
      assert.ok((await sortDoneRaw(t.sale.taskId, [{ containerId: Number(t.picks[0].id), binCode: t.binCode }], key('nu2'))).ok, '标签 60 分拣失败')
      assert.equal(await sortedOf(), 110, '50+60 应为 110')
      assert.ok((await sortDoneRaw(t.sale.taskId, [{ containerId: Number(t.picks[1].id), binCode: t.binCode }], key('nu3'))).ok, '标签 90 分拣失败')
      assert.equal(await sortedOf(), 200, '50+150 应恰好 200')
      ;[st] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.sale.taskId])
      assert.equal(Number(st.status), 4, '标签全扫完后应推进到待复核(4)')
    })

    // ── B3a-S10 进度中（任务仍 3）原键重放 / 新键重复同一取货码 ─────────────
    await check('分拣进度中（任务仍3）原键重放返回原回执；换新键重复同一取货码被拒', async () => {
      const t = await mixedTaskFixture()
      const items = [{ containerId: Number(t.picks[0].id), binCode: t.binCode }]
      const k = key('prog-replay')
      const sortedOf = async () =>
        Number((await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.sale.itemId]))[0].sorted_qty)
      const sbiCount = async () =>
        Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM sorting_bin_items WHERE task_id=?', [t.sale.taskId]))[0].c)

      const first = await sortDoneRaw(t.sale.taskId, items, k)
      assert.ok(first.ok, `首次分拣应成功：${first.status} ${JSON.stringify(first.data).slice(0, 220)}`)
      assert.equal(await sortedOf(), 60, '首次后 sorted_qty 应为 60')
      assert.equal(await sbiCount(), 1, '首次后应有一条作业记录')

      // ① 原键重放：任务仍停在待分拣(3)，同样必须走 replay 分支返回原回执、不重复推进
      const replay = await sortDoneRaw(t.sale.taskId, items, k)
      assert.ok(replay.ok, `原键重放应返回原成功结果：${replay.status} ${JSON.stringify(replay.data).slice(0, 220)}`)
      assert.equal(Number((await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.sale.taskId]))[0].status), 3, '重放不得推进任务状态')
      assert.equal(await sortedOf(), 60, '重放不得重复累加 sorted_qty')
      assert.equal(await sbiCount(), 1, '重放不得新增作业记录')

      // ② 换新键重扫同一张取货码：由 uk_task_container 明确拒绝，不产生第二条记录
      const dup = await sortDoneRaw(t.sale.taskId, items, key('prog-dup'))
      assert.ok(!dup.ok, `新键重复同一取货码必须拒绝，实际 ${dup.status} ${JSON.stringify(dup.data).slice(0, 200)}`)
      assert.match(String(dup.data?.message || ''), /已经分拣过/, '拒绝理由应指向重复分拣')
      assert.equal(await sortedOf(), 60, '被拒不得改变 sorted_qty')
      assert.equal(await sbiCount(), 1, '被拒不得新增作业记录')
    })

    // ── B3a-S11 分拣：范围 / 设备仓校验必须覆盖重放（service 直调，沿用批 A 口径）──
    await check('分拣范围校验覆盖重放：合法成功后用越权范围/异仓设备同键重放均被拒', async () => {
      const wtSvc = require('../backend/src/modules/warehouse-tasks/warehouse-tasks.service')

      const t = await taskAtSorting(60)
      const k = key('scope-replay')
      const items = [{ containerId: Number(t.newI.id), binCode: t.binCode }]
      const okFirst = await wtSvc.sortTask(t.taskId, items, { requestKey: k, userId: 1 })
      assert.ok(okFirst?.allSorted, '首次 service 分拣应成功')
      await assert.rejects(
        () => wtSvc.sortTask(t.taskId, items, { requestKey: k, userId: 1, scopeWarehouseIds: [999999] }),
        (e) => Number(e.statusCode) === 403,
        '越权范围重放当前未被拦下',
      )

      const t2 = await taskAtSorting(50)
      const k2 = key('device-replay')
      const items2 = [{ containerId: Number(t2.newI.id), binCode: t2.binCode }]
      const okFirst2 = await wtSvc.sortTask(t2.taskId, items2, { requestKey: k2, userId: 1 })
      assert.ok(okFirst2?.allSorted, '首次 service 分拣应成功')
      await assert.rejects(
        () => wtSvc.sortTask(t2.taskId, items2, { requestKey: k2, userId: 1, pdaWarehouseId: 999999 }),
        (e) => Number(e.statusCode) === 403,
        '异仓设备重放当前未被拦下',
      )
    })

    // ── B3a-S12 复核：设备仓覆盖重放 + 错 task 取货码不得复核 ────────────────
    await check('复核设备仓校验覆盖重放；他任务取货码不能复核且 checked 不变', async () => {
      const scanLogSvc = require('../backend/src/modules/scan-logs/scan-logs.service')

      const t = await taskAtChecking(25)
      const k = key('chk-device-replay')
      const first = await scanLogSvc.createCheckScanLog({
        taskId: t.taskId, barcode: t.newI.barcode, operatorId: 1, operatorName: 'smoke_admin', requestKey: k,
      })
      assert.ok(first?.id, '合法复核应成功')
      await assert.rejects(
        () => scanLogSvc.createCheckScanLog({
          taskId: t.taskId, barcode: t.newI.barcode, operatorId: 1, operatorName: 'smoke_admin',
          requestKey: k, pdaWarehouseId: 999999,
        }),
        (e) => Number(e.statusCode) === 403,
        '异仓设备同键重放当前未被拦下',
      )

      // 错 task：b 的新 I 不能用于 a 的复核，且 a 的 checked_qty 不变
      const a = await taskAtSorting(20)
      const sb = await sortDoneRaw(a.taskId, [{ containerId: Number(a.newI.id), binCode: a.binCode }], key('s'))
      assert.ok(sb.ok, `前置：a 分拣失败：${JSON.stringify(sb.data).slice(0, 200)}`)
      const b = await taskAtSorting(20)
      const before = Number((await dbQuery(pool, 'SELECT checked_qty FROM warehouse_task_items WHERE id=?', [a.itemId]))[0].checked_qty)
      const wrong = await checkScan(a.taskId, b.newI.barcode, key('chk-wrong-task'))
      assert.ok(!wrong.ok, `他任务取货码不得复核，实际 ${wrong.status} ${JSON.stringify(wrong.data).slice(0, 200)}`)
      const after = Number((await dbQuery(pool, 'SELECT checked_qty FROM warehouse_task_items WHERE id=?', [a.itemId]))[0].checked_qty)
      assert.equal(after, before, '被拒不得改变 checked_qty')
    })

    // ── B3a-S13 旧 sortedQty 精度：三位小数必须 4xx 且原值无进度 ──────────────
    await check('旧商品码报三位小数必须 4xx，且不产生任何进度（不静默舍入）', async () => {
      const t = await legacyTaskAtSorting(50)
      const r = await sortDoneRaw(t.sale.taskId, [{ itemId: t.sale.itemId, sortedQty: 50.123 }], key('prec'))
      assert.ok(!r.ok, `三位小数必须拒绝，实际 ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
      assert.equal(Number(r.status), 400, '应为 4xx 业务错误')
      const row = await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.sale.itemId])
      assert.equal(Number(row[0].sorted_qty), 0, '被拒不得产生任何进度')
      const [st] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.sale.taskId])
      assert.equal(Number(st.status), 3, '任务应仍在待分拣(3)')
    })

    // ── B3a-S14 支持边界：一次只能提交一张取货码（服务端显式拒绝，不靠隐含假设）──
    await check('一次提交多张取货码被服务端显式拒绝，且零进度副作用', async () => {
      const t = await mixedTaskFixture()
      const sortedOf = async () =>
        Number((await dbQuery(pool, 'SELECT sorted_qty FROM warehouse_task_items WHERE id=?', [t.sale.itemId]))[0].sorted_qty)
      const r = await sortDoneRaw(t.sale.taskId, [
        { containerId: Number(t.picks[0].id), binCode: t.binCode },
        { containerId: Number(t.picks[1].id), binCode: t.binCode },
      ], key('multi'))
      assert.ok(!r.ok, `多张取货码必须显式拒绝，实际 ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
      assert.equal(Number(r.status), 400, '应为 4xx 业务错误')
      assert.match(String(r.data?.message || ''), /一次只能提交一张取货码/, '拒绝理由应明确指出单次上限')
      assert.equal(await sortedOf(), 0, '被拒不得产生任何进度')
      const sbi = await dbQuery(pool, 'SELECT COUNT(*) c FROM sorting_bin_items WHERE task_id=?', [t.sale.taskId])
      assert.equal(Number(sbi[0].c), 0, '被拒不得落任何作业记录')
    })
  } finally {
    // 按**自建 ID** 逐笔合法取消 + 归还：**每个响应都检查**，任何失败计入 `failed`
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
            token,
            headers: pdaHeaders(),
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

    // 只删**自己建的**分拣格（不触碰他人资源）；仍被占用就保留并如实记录。
    // 逐格 try/catch：任何一个删除请求抛错都不能让后面的 close 被跳过（否则进程吊着不退）。
    for (const binId of createdBins) {
      try {
        const r = await http.delete(`/api/sorting-bins/${binId}`, { token })
        if (!r.ok) {
          console.warn(`[WARN] 收尾：自建分拣格 ${binId} 未删除、保留原状（可能仍被占用）：${r.status} ${JSON.stringify(r.data).slice(0, 120)}`)
        }
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
