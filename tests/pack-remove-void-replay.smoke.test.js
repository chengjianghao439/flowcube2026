'use strict'

/**
 * 装箱异常恢复 · `remove-item` / `void` 的稳定键与原目标回执。
 *
 * 已证实缺陷（Codex 定向 probe，`/tmp/flow-plastic-box-remove-replay-codex-probe-20260929.log`）：
 * 同箱同明细、同一 `X-Request-Key`、`qty=10` 连发两次 ⇒ 60→50→40，两次都 200。
 * 即 `remove-item` **忽略请求键**、每次真的再扣一次；`void` 同样没有请求键。
 *
 * 本套件先钉住**正确语义**（红），再窄修：
 *  - 同键重放**只生效一次**，且返回**与首次一致的回执**；
 *  - **整行已被删除**之后用原键重放仍须返回原回执（不能让「明细不存在」挡在成功重放之前）；
 *  - **新键**是合法的第二次移出，必须照常生效（幂等不得误伤正常操作）；
 *  - 幂等是**资源级**的：A 箱的键带到 B 箱**不命中**，既不返回 A 的回执、也不误动 B；
 *  - `void` 同键重放返回**首次**回执；**新键**对已作废箱仍按现有 400 拒绝（不写成"重复改数据"）；
 *  - 范围 / 设备仓校验必须**先于**重放（越权重放不得拿到原回执）。
 *
 * 断言口径：HTTP 状态码 + **数据库事实**（`package_items` 行与数量、`packages.status`）。
 * 任一项失败即 `process.exitCode = 1`。
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

  // ── 真实业务链夹具（与 B4 同构）────────────────────────────────────────────
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

  async function saleToTask(qty) {
    const sale = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('pb-rm'),
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

  const createdBins = []
  async function ensureFreeBin() {
    const list = await http.get(`/api/sorting-bins/warehouse/${warehouse.id}`, { token })
    const free = (list.data?.data ?? []).find(b => Number(b.status) === 1)
    if (free) return free
    const code = `RR${String(randomRef('B')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`
    const created = await http.post('/api/sorting-bins', {
      token, json: { code, warehouseId: Number(warehouse.id), remark: 'pb-rm' },
    })
    assert.ok(created.ok, `自建分拣格失败：${JSON.stringify(created.data).slice(0, 200)}`)
    const id = Number(created.data.data.id)
    createdBins.push(id)
    return { id, code, status: 1 }
  }

  /** 真实链造「盒取 qty ⇒ 本任务锁定的新 I ⇒ 分拣 ⇒ 复核 ⇒ 建箱并把该标签整份装入」 */
  async function packedBox(qty) {
    await ensureFreeBin()
    const src = await makeWholeContainer(qty)
    const box = await createEmptyBox()
    assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
    const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
    const sale = await saleToTask(qty)
    const picked = await http.post('/api/scan-logs', {
      token, headers: { ...pdaHeaders(), 'X-Request-Key': key('pick') },
      json: { taskId: sale.taskId, itemId: sale.itemId, containerId: box, barcode: boxBarcode, productId: Number(product.id), qty, scanMode: '整件' },
    })
    assert.ok(picked.ok, `前置：扫盒取货失败：${JSON.stringify(picked.data).slice(0, 220)}`)
    const [newI] = await dbQuery(pool,
      "SELECT id, barcode FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1",
      [box])
    assert.ok(newI, '前置：应生成新 I')

    assert.ok((await http.put(`/api/warehouse-tasks/${sale.taskId}/ready`, { token, headers: pdaHeaders() })).ok, '前置：ready 失败')
    const [tk] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [sale.taskId])
    const sd = await http.put(`/api/warehouse-tasks/${sale.taskId}/sort-done`, {
      token, headers: { ...pdaHeaders(), 'X-Request-Key': key('sort') },
      json: { items: [{ containerId: Number(newI.id), binCode: tk.sorting_bin_code }] },
    })
    assert.ok(sd.ok, `前置：分拣失败：${JSON.stringify(sd.data).slice(0, 220)}`)

    const locked = await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE locked_by_task_id=?', [sale.taskId])
    for (const c of locked) {
      const cr = await http.post('/api/scan-logs/check', {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('chk') }, json: { taskId: sale.taskId, barcode: c.barcode },
      })
      assert.ok(cr.ok, `前置：复核 ${c.barcode} 失败：${cr.status} ${JSON.stringify(cr.data).slice(0, 200)}`)
    }
    const [tk5] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [sale.taskId])
    assert.equal(Number(tk5.status), 5, '前置：应进入待打包(5)')

    const pkg = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: sale.taskId } })
    assert.ok(pkg.ok, `前置：建箱失败：${JSON.stringify(pkg.data).slice(0, 220)}`)
    const pkgId = Number(pkg.data.data.id)
    const add = await http.post(`/api/packages/${pkgId}/add-item`, {
      token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add') }, json: { labelBarcode: newI.barcode },
    })
    assert.ok(add.ok, `前置：标签入箱失败：${JSON.stringify(add.data).slice(0, 220)}`)
    return { ...sale, box, newI, pkgId, itemLineId: Number(add.data.data.itemId), lineQty: Number(add.data.data.qty) }
  }

  const lineQtyOf = async (lineId) => {
    const rows = await dbQuery(pool, 'SELECT qty FROM package_items WHERE id=?', [lineId])
    return rows.length ? Number(rows[0].qty) : null
  }
  const pkgStatusOf = async (pkgId) => Number((await dbQuery(pool, 'SELECT status FROM packages WHERE id=?', [pkgId]))[0].status)
  const lineCountOf = async (pkgId) => Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM package_items WHERE package_id=?', [pkgId]))[0].c)

  const removeReq = (pkgId, body, k, headers) =>
    http.post(`/api/packages/${pkgId}/remove-item`, {
      token, headers: { ...(headers || pdaHeaders()), ...(k ? { 'X-Request-Key': k } : {}) }, json: body,
    })
  const voidReq = (pkgId, k, headers) =>
    http.post(`/api/packages/${pkgId}/void`, {
      token, headers: { ...(headers || pdaHeaders()), ...(k ? { 'X-Request-Key': k } : {}) }, json: {},
    })

  // ── 越权夹具：独立仓库 + 独立 PDA 设备（**走合法 ERP 接口登记**，不直接造状态）───────
  // 只为验证「范围 / 设备仓校验先于重放」：这台设备的绑定仓与夹具任务仓不同。
  const createdDevices = []
  const createdWarehouses = []
  let pda2Headers = null
  try {
    const whResp = await http.post('/api/warehouses', {
      token,
      json: { name: `PB-C1-SCOPE-${String(randomRef('W')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`, type: 1 },
    })
    assert.ok(whResp.ok, `前置：建独立仓库失败：${whResp.status} ${JSON.stringify(whResp.data).slice(0, 200)}`)
    const wh2Id = Number(whResp.data.data.id)
    createdWarehouses.push({ id: wh2Id })

    const dev = await http.post('/api/pda-devices', {
      token, json: { deviceName: `PB-C1-SCOPE-${randomRef('D')}`, warehouseId: wh2Id },
    })
    assert.ok(dev.ok, `前置：登记独立设备失败：${dev.status} ${JSON.stringify(dev.data).slice(0, 200)}`)
    createdDevices.push({ id: Number(dev.data.data.id) })

    const ses = await http.post('/api/pda/sessions', {
      token,
      json: { device_code: dev.data.data.deviceCode, device_secret: dev.data.data.deviceSecret },
    })
    assert.ok(ses.ok, `前置：换设备票据失败：${ses.status} ${JSON.stringify(ses.data).slice(0, 200)}`)
    const t2 = ses.data.data.session_token
    pda2Headers = () => ({ 'X-Client': 'pda', 'X-PDA-Session': t2 })
  } catch (e) {
    console.error(`[WARN] 越权夹具创建失败，相关用例将失败：${e.message}`)
  }

  try {
    // ── S1 remove 部分移出：同键重放只生效一次，且回执与首次一致 ─────────────────
    await check('remove 部分移出：同键重放只扣一次，回执与首次一致', async () => {
      const t = await packedBox(150)
      assert.equal(t.lineQty, 150, '前置：标签应整份入箱 150')
      const k = key('rm-same')

      const r1 = await removeReq(t.pkgId, { itemId: t.itemLineId, qty: 10 }, k)
      assert.ok(r1.ok, `首次移出失败：${r1.status} ${JSON.stringify(r1.data).slice(0, 220)}`)
      assert.equal(await lineQtyOf(t.itemLineId), 140, '首次移出后应剩 140')

      const r2 = await removeReq(t.pkgId, { itemId: t.itemLineId, qty: 10 }, k)
      console.log(`[INFO] 同键重放=${r2.status} 行余=${await lineQtyOf(t.itemLineId)}`)
      assert.ok(r2.ok, `同键重放应成功返回原回执：${r2.status} ${JSON.stringify(r2.data).slice(0, 220)}`)
      assert.equal(await lineQtyOf(t.itemLineId), 140, '同键重放**不得**再扣一次（应仍为 140）')
      assert.deepEqual(r2.data?.data, r1.data?.data, '同键重放应返回与首次**一致**的回执')
    })

    // ── S2 remove 整行删除后：原键重放仍须返回原回执 ─────────────────────────────
    await check('remove 整行删除后：原键重放仍返回原回执（明细不存在不得挡在重放前）', async () => {
      const t = await packedBox(150)
      const k = key('rm-all')

      const r1 = await removeReq(t.pkgId, { itemId: t.itemLineId }, k)
      assert.ok(r1.ok, `整行移出失败：${r1.status} ${JSON.stringify(r1.data).slice(0, 220)}`)
      assert.equal(r1.data?.data?.removed, true, '整行移出回执应标记 removed=true')
      assert.equal(await lineQtyOf(t.itemLineId), null, '整行应已删除')

      const r2 = await removeReq(t.pkgId, { itemId: t.itemLineId }, k)
      console.log(`[INFO] 整行删后同键重放=${r2.status} ${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.ok(r2.ok, `整行删后原键重放应返回原回执：${r2.status} ${JSON.stringify(r2.data).slice(0, 220)}`)
      assert.deepEqual(r2.data?.data, r1.data?.data, '重放回执应与首次一致')
      assert.equal(await lineCountOf(t.pkgId), 0, '重放不得凭空造回明细行')
    })

    // ── S3 remove 新键：合法的第二次移出必须照常生效 ─────────────────────────────
    await check('remove 新键：合法的第二次移出正常生效（幂等不误伤）', async () => {
      const t = await packedBox(150)
      const a = await removeReq(t.pkgId, { itemId: t.itemLineId, qty: 10 }, key('rm-a'))
      assert.ok(a.ok, `第一次移出失败：${a.status}`)
      assert.equal(await lineQtyOf(t.itemLineId), 140, '第一次后应剩 140')

      const b = await removeReq(t.pkgId, { itemId: t.itemLineId, qty: 10 }, key('rm-b'))
      assert.ok(b.ok, `新键第二次移出应成功：${b.status} ${JSON.stringify(b.data).slice(0, 220)}`)
      assert.equal(await lineQtyOf(t.itemLineId), 130, '新键第二次应真的再扣 10（剩 130）')
    })

    // ── S4 remove 资源级绑定：A 箱的键带到 B 箱时，B 独立执行 ────────────────────
    await check('remove 资源级绑定：A 箱的键带到 B 箱时 B 独立执行、不重放 A、不再次改动 A', async () => {
      const A = await packedBox(150)
      const B = await packedBox(150)
      const k = key('rm-bind')

      const rA = await removeReq(A.pkgId, { itemId: A.itemLineId, qty: 10 }, k)
      assert.ok(rA.ok, `A 箱移出失败：${rA.status}`)
      assert.equal(await lineQtyOf(A.itemLineId), 140, '前置：A 应剩 140')

      // 同一个键，但资源换成 B 箱 ⇒ 不是同一个操作，应正常执行（而不是回放 A 的回执）
      const rB = await removeReq(B.pkgId, { itemId: B.itemLineId, qty: 10 }, k)
      assert.ok(rB.ok, `B 箱（新资源）应正常执行：${rB.status} ${JSON.stringify(rB.data).slice(0, 220)}`)
      assert.notDeepEqual(rB.data?.data, rA.data?.data, 'B 箱不得拿到 A 箱的回执')
      assert.equal(await lineQtyOf(B.itemLineId), 140, 'B 应真的被扣 10')
      assert.equal(await lineQtyOf(A.itemLineId), 140, 'A 不得因 B 的请求再被扣')
    })

    // ── S5 void：同键重放返回首次回执；新键对已作废箱仍 400 ───────────────────────
    await check('void 同键重放返回首次回执；新键对已作废箱仍按现有 400 拒绝', async () => {
      const t = await packedBox(150)
      const k = key('void-same')

      const v1 = await voidReq(t.pkgId, k)
      assert.ok(v1.ok, `作废失败：${v1.status} ${JSON.stringify(v1.data).slice(0, 220)}`)
      assert.equal(await pkgStatusOf(t.pkgId), 3, '首次作废后箱应为已作废(3)')

      const v2 = await voidReq(t.pkgId, k)
      console.log(`[INFO] void 同键重放=${v2.status} ${JSON.stringify(v2.data).slice(0, 200)}`)
      assert.ok(v2.ok, `同键重放应返回首次回执：${v2.status} ${JSON.stringify(v2.data).slice(0, 220)}`)
      assert.deepEqual(v2.data?.data, v1.data?.data, '重放回执应与首次一致')
      assert.equal(await pkgStatusOf(t.pkgId), 3, '重放不得改动箱状态')

      const v3 = await voidReq(t.pkgId, key('void-new'))
      console.log(`[INFO] void 新键=${v3.status} ${JSON.stringify(v3.data).slice(0, 200)}`)
      assert.ok(!v3.ok, `新键对已作废箱应仍按现有语义拒绝，实际 ${v3.status}`)
      assert.equal(v3.status, 400, '新键重复作废应为 400（现有拒绝语义保留）')
    })

    // ── S6 void 资源级绑定：A 箱的键带到 B 箱不命中 ──────────────────────────────
    await check('void 资源级绑定：A 箱的键带到 B 箱不命中，B 正常作废', async () => {
      const A = await packedBox(150)
      const B = await packedBox(150)
      const k = key('void-bind')

      assert.ok((await voidReq(A.pkgId, k)).ok, '前置：A 作废失败')
      assert.equal(await pkgStatusOf(A.pkgId), 3, '前置：A 应已作废')

      const rB = await voidReq(B.pkgId, k)
      assert.ok(rB.ok, `B 箱（新资源）应正常作废：${rB.status} ${JSON.stringify(rB.data).slice(0, 220)}`)
      assert.equal(await pkgStatusOf(B.pkgId), 3, 'B 应被作废')
      assert.notEqual(Number(rB.data?.data?.id ?? 0), Number(A.pkgId), 'B 的回执不得指向 A')
    })

    // ── S7 范围 / 设备仓校验先于重放：越权会话持原键重放 → 403，数据不变 ──────────
    // 两个 action **各自都必须先有本 action 的成功回执**，否则 403 只能证明「首次被设备仓拒绝」，
    // 证明不了「重放不得绕过校验拿到原回执」——后者才是这条要钉的语义。
    await check('范围/设备仓校验先于重放：remove 与 void 各自先有成功回执，越权持原键重放被拒 403', async () => {
      assert.ok(pda2Headers, '前置：越权设备夹具应已就绪')

      // ① remove：先合法移出产生 `package.remove-item.<箱>` 的成功回执，再越权同键重放
      const t = await packedBox(150)
      const k = key('rm-scope')
      const ok1 = await removeReq(t.pkgId, { itemId: t.itemLineId, qty: 10 }, k)
      assert.ok(ok1.ok, `前置：合法移出失败：${ok1.status} ${JSON.stringify(ok1.data).slice(0, 200)}`)
      assert.equal(await lineQtyOf(t.itemLineId), 140, '前置：应剩 140')

      const r2 = await removeReq(t.pkgId, { itemId: t.itemLineId, qty: 10 }, k, pda2Headers())
      console.log(`[INFO] remove 越权同键重放=${r2.status} ${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.equal(r2.status, 403, `remove 越权重放应 403（不得拿到原回执），实际 ${r2.status}`)
      assert.match(String(r2.data?.message || ''), /仓库/, '拒绝理由应指向设备绑定仓库不一致')
      assert.equal(await lineQtyOf(t.itemLineId), 140, '越权请求不得改动明细数量')

      // ② void：作废是终态，**先合法作废**产生 `package.void.<箱>` 的成功回执，再越权同键重放
      const t2 = await packedBox(150)
      const kv = key('void-scope')
      const v1 = await voidReq(t2.pkgId, kv)
      assert.ok(v1.ok, `前置：合法作废失败：${v1.status} ${JSON.stringify(v1.data).slice(0, 200)}`)
      assert.equal(await pkgStatusOf(t2.pkgId), 3, '前置：箱应已作废')

      const v2 = await voidReq(t2.pkgId, kv, pda2Headers())
      console.log(`[INFO] void 越权同键重放=${v2.status} ${JSON.stringify(v2.data).slice(0, 200)}`)
      assert.equal(v2.status, 403, `void 越权重放应 403（不得拿到原回执），实际 ${v2.status}`)
      assert.equal(await pkgStatusOf(t2.pkgId), 3, '越权请求不得改动箱状态')
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
        const st = Number(tk.status)
        if ((st === 7 || st === 8) && locked.length === 0) { cleaned++; continue }

        if (st !== 8 && !tk.cancel_requested_at) {
          const c = await http.post(`/api/sale/${saleId}/cancel`, { token })
          if (!c.ok) { failed++; console.error(`[FAIL] 收尾：cancel sale ${saleId} -> ${c.status} ${JSON.stringify(c.data).slice(0, 120)}`); continue }
        }
        const d = await http.get(`/api/warehouse-tasks/${taskId}/cancel-return-detail`, { token })
        if (!d.ok) { failed++; console.error(`[FAIL] 收尾：cancel-return-detail task ${taskId} -> ${d.status} ${JSON.stringify(d.data).slice(0, 120)}`); continue }
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
        const st2 = Number((await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId]))[0].status)
        const left = Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_containers WHERE locked_by_task_id=?', [taskId]))[0].c ?? -1)
        if (st2 !== 8 || left !== 0) {
          failed++
          console.error(`[FAIL] 收尾核对：task ${taskId} status=${st2} 剩余锁=${left}`)
        } else cleaned++
      } catch (e) {
        failed++
        console.error(`[FAIL] 收尾 sale ${saleId}/task ${taskId} 异常：${e.message}`)
      }
    }
    console.log(`[INFO] 自建销售夹具 ${createdSales.length} 笔，收尾核对通过 ${cleaned} 笔，失败 ${createdSales.length - cleaned} 笔`)

    for (const binId of createdBins) {
      try {
        const r = await http.delete(`/api/sorting-bins/${binId}`, { token })
        if (!r.ok) console.warn(`[WARN] 收尾：自建分拣格 ${binId} 未删除、保留原状：${r.status}`)
      } catch (e) {
        console.warn(`[WARN] 收尾：自建分拣格 ${binId} 删除请求异常、保留原状：${e.message}`)
      }
    }

    // 越权夹具收尾（全部走**合法接口**）。失败**计 FAIL**，并按**只读核对结果**报告 ——
    // 不能"请求发出去了"就当作收尾成功。
    let devicesOk = 0
    for (const d of createdDevices) {
      // 整轮（含只读核对 SQL）都包住：核对查询本身抛错**不能**中断 finally 的后半段，
      // 否则会跳过下面的 close() / pool.end()，让测试服务与连接池吊着不退。
      try {
        let unStatus = null
        let stStatus = null
        try {
          const un = await http.put(`/api/pda-devices/${d.id}`, { token, json: { warehouseId: null } })
          unStatus = un.status
        } catch (e) { unStatus = `ERR:${e.message}` }
        try {
          const r = await http.put(`/api/pda-devices/${d.id}/status`, { token, json: { status: 'disabled' } })
          stStatus = r.status
        } catch (e) { stStatus = `ERR:${e.message}` }

        // 只读核对：解绑为 null、已停用、**无有效票据**（停用会连带吊销；有效 = 未吊销且未过期）
        const [dev] = await dbQuery(pool, 'SELECT warehouse_id, status FROM pda_devices WHERE id=?', [d.id])
        const [sess] = await dbQuery(pool,
          'SELECT COUNT(*) AS c FROM pda_device_sessions WHERE device_id=? AND revoked_at IS NULL AND expires_at > NOW()',
          [d.id])
        const okUnbind = dev != null && dev.warehouse_id == null
        const okDisabled = dev != null && String(dev.status) === 'disabled'
        const okNoSession = Number(sess?.c ?? -1) === 0
        if (unStatus === 200 && stStatus === 200 && okUnbind && okDisabled && okNoSession) {
          devicesOk++
        } else {
          failed++
          console.error(`[FAIL] 收尾核对：越权设备 ${d.id} unbind=${unStatus} disable=${stStatus} `
            + `warehouse_id=${dev?.warehouse_id} status=${dev?.status} 有效票据=${sess?.c}`)
        }
      } catch (e) {
        failed++
        console.error(`[FAIL] 收尾核对：越权设备 ${d.id} 核对过程异常：${e.message}`)
      }
    }

    let warehousesOk = 0
    for (const w of createdWarehouses) {
      try {
        let delStatus = null
        try {
          const r = await http.delete(`/api/warehouses/${w.id}`, { token })
          delStatus = r.status
        } catch (e) { delStatus = `ERR:${e.message}` }
        // 只读核对：**软删**（`deleted_at` 非空、行仍在），不是物理删除
        const [wh] = await dbQuery(pool, 'SELECT deleted_at FROM inventory_warehouses WHERE id=?', [w.id])
        if (delStatus === 200 && wh != null && wh.deleted_at != null) {
          warehousesOk++
        } else {
          failed++
          console.error(`[FAIL] 收尾核对：越权仓库 ${w.id} delete=${delStatus} deleted_at=${wh?.deleted_at}`)
        }
      } catch (e) {
        failed++
        console.error(`[FAIL] 收尾核对：越权仓库 ${w.id} 核对过程异常：${e.message}`)
      }
    }
    console.log(`[INFO] 自建越权夹具收尾核对：设备 ${devicesOk}/${createdDevices.length} 台（已解绑 + 已停用 + 无有效票据）、`
      + `仓库 ${warehousesOk}/${createdWarehouses.length} 个（已软删）`)

    try { await close() } catch (e) { failed++; console.error(`[FAIL] 关闭测试服务/连接池失败：${e.message}`) }
    try { await require('../backend/src/config/db').pool.end() } catch (e) { failed++; console.error(`[FAIL] 关闭全局连接池失败：${e.message}`) }
  }

  console.log(`\n${'='.repeat(50)}\n  ${passed} passed, ${failed} failed\n${'='.repeat(50)}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error('套件异常终止：', e); process.exitCode = 1 })
