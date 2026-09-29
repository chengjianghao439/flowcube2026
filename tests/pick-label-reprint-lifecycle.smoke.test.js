'use strict'

/**
 * 批 B4 补充专项 · 取货标签补打的**生命周期**边界。
 *
 * 背景：B4 为修「取消归还后仍能照旧打出取货标签」，给补打入口加了「容器当前锁定于某任务」的
 * guard。但取货标签的变量设计**明确**取自真实 PICK 行——见 `enqueuePickLabelJob` 注释：
 * 「发货/减量后容器余量会归 0，按余量取会把标签补打成 0 个」。也就是说**已出库**之后补打取货
 * 标签原本是被支持的场景。本套件用真实链把这条既有能力钉住，同时守住两条**不得越界**的方向：
 * 已取消的 free ACTIVE 仍须拒绝、被下一任务当普通整件复用的码不得认回旧取货标签。
 *
 * 全链真实 API：采购→收货→上架 → 建盒/放货 → 销售→占库→发货 → 扫盒取货 → ready →
 * sort-done → 复核 → 装箱 → finish（打印入队）→ **claim-client + complete-client**（真实打印客户端
 * 姿势收口箱贴）→ pack-done → 任务出库(7)。任一步失败即 process.exitCode = 1。
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
const { acquireOwnPackageLabelPrinter, releaseOwnPackageLabelPrinter } = require('./helpers/ownedPrintFixture')

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
  // 本套自建的「箱贴打印前提」（C2 起 finish 需要 package_label 的真实绑定）
  let ownPrint = null
  try {
    const authed = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    token = authed.token
    assert.ok(token, '管理员应登录成功')
    // C2 起 finishPackage 走 assertQueueReady(package_label, requireBinding=true)：
    // 全局 SMOKE-PRN 不满足该用途，必须有本仓的 package_label 绑定。本套自建打印机 +
    // 工作站并绑到本套仓库；收尾按原值恢复、只停用自建打印机（不留绑定给后续套件）。
    ownPrint = await acquireOwnPackageLabelPrinter({ http, token, warehouseId: warehouse.id, assert, randomRef })
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

  async function saleToTask(qty) {
    const sale = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('pb-reprint'),
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

  const createdBins = []
  async function ensureFreeBin() {
    const list = await http.get(`/api/sorting-bins/warehouse/${warehouse.id}`, { token })
    const free = (list.data?.data ?? []).find(b => Number(b.status) === 1)
    if (free) return free
    const code = `PR${String(randomRef('B')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`
    const created = await http.post('/api/sorting-bins', {
      token, json: { code, warehouseId: Number(warehouse.id), remark: 'pb-reprint' },
    })
    assert.ok(created.ok, `自建分拣格失败：${JSON.stringify(created.data).slice(0, 200)}`)
    const id = Number(created.data.data.id)
    createdBins.push(id)
    return { id, code, status: 1 }
  }

  const readyApi = (taskId) => http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: pdaHeaders() })
  const sortDoneRaw = (taskId, items, k) =>
    http.put(`/api/warehouse-tasks/${taskId}/sort-done`, {
      token, headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) }, json: { items },
    })
  const checkScan = (taskId, barcode, k) =>
    http.post('/api/scan-logs/check', {
      token, headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) }, json: { taskId, barcode },
    })
  const reprint = (containerId) =>
    http.post('/api/print-jobs/barcodes/reprint', { token, json: { category: 'inbound', recordId: Number(containerId) } })

  const containerOf = async (id) =>
    (await dbQuery(pool, 'SELECT remaining_qty, status, locked_by_task_id FROM inventory_containers WHERE id=?', [id]))[0]
  const taskOf = async (id) =>
    (await dbQuery(pool, 'SELECT status, cancel_requested_at FROM warehouse_tasks WHERE id=?', [id]))[0]
  const pickRowsOf = async (taskId, containerId) => dbQuery(pool,
    `SELECT id, source_container_id FROM scan_logs
      WHERE task_id=? AND container_id=? AND COALESCE(scan_purpose,1)=1`, [taskId, containerId])

  /** 真实链造「盒取 qty ⇒ 本任务锁定的新 I(qty)」，任务停在拣货中(2) */
  async function taskWithPickLabel(qty) {
    await ensureFreeBin()
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
    return { ...sale, box, boxBarcode, newI }
  }

  try {
    // ── S6-A 已出库（EMPTY + 解锁）后的取货标签补打：既有能力必须保留 ─────────────
    // `enqueuePickLabelJob` 的变量取自真实 PICK 行，正是为了「发货后余量归 0」仍能打出原取货量。
    // 若补打入口用「当前锁为空」一概拒绝，这条既有能力就被误伤。
    await check('已出库后（EMPTY+解锁）补打取货标签：应按真实已出库任务与 PICK 打出原取货量', async () => {
      const t = await taskWithPickLabel(150)

      // ① 分拣 → 复核 → 装箱（标签整份）→ finish（打印入队）
      assert.ok((await readyApi(t.taskId)).ok, '前置：ready 失败')
      const [tk3] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [t.taskId])
      const sd = await sortDoneRaw(t.taskId, [{ containerId: Number(t.newI.id), binCode: tk3.sorting_bin_code }], key('sort'))
      assert.ok(sd.ok, `前置：分拣失败：${JSON.stringify(sd.data).slice(0, 220)}`)

      const locked = await dbQuery(pool, 'SELECT id, barcode FROM inventory_containers WHERE locked_by_task_id=?', [t.taskId])
      for (const c of locked) {
        const cr = await checkScan(t.taskId, c.barcode, key('chk'))
        assert.ok(cr.ok, `前置：复核 ${c.barcode} 失败：${cr.status} ${JSON.stringify(cr.data).slice(0, 220)}`)
      }
      assert.equal(Number((await taskOf(t.taskId)).status), 5, '前置：复核闭合后应进入待打包(5)')

      const pkg = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: t.taskId } })
      assert.ok(pkg.ok, `前置：建箱失败：${pkg.status} ${JSON.stringify(pkg.data).slice(0, 220)}`)
      const pkgId = Number(pkg.data.data.id)
      const add = await http.post(`/api/packages/${pkgId}/add-item`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add') }, json: { labelBarcode: t.newI.barcode },
      })
      assert.ok(add.ok, `前置：标签入箱失败：${add.status} ${JSON.stringify(add.data).slice(0, 220)}`)
      assert.equal(Number(add.data.data.qty), 150, '前置：标签应整份入箱 150')

      const fin = await http.put(`/api/packages/${pkgId}/finish`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('fin') },
      })
      assert.ok(fin.ok, `前置：finish 失败：${fin.status} ${JSON.stringify(fin.data).slice(0, 250)}`)
      const printJobId = Number(fin.data?.data?.printJobId)
      assert.ok(printJobId > 0, '前置：finish 应产生箱贴打印任务')

      // ② 收口箱贴打印任务：**真实** `claim-client` → `complete-client`，用**本套自建**的打印机与
      //    工作站（`ownPrint.clientId`）—— 不用 smokeTestKit 的 SMOKE-PRN，避免领取/结算到别的套件
      //    或历史任务；且**只结算本轮 `finish` 产出的那个 job**（按 id 匹配）。
      //    **只证明 API 闭环，不代表实际出纸。**
      const claim = await http.post('/api/print-jobs/claim-client', {
        token, json: { clientId: ownPrint.clientId, limit: 50 },
      })
      assert.ok(claim.ok, `前置：claim-client 失败：${claim.status} ${JSON.stringify(claim.data).slice(0, 220)}`)
      const claimed = (claim.data?.data || []).find(j => Number(j.id) === printJobId)
      assert.ok(claimed?.ackToken, `前置：claim 应返回本任务的 job 与其 ackToken：${JSON.stringify(claim.data).slice(0, 300)}`)
      const done = await http.post(`/api/print-jobs/${printJobId}/complete-client`, {
        token, headers: { 'X-Client-Id': ownPrint.clientId }, json: { ackToken: claimed.ackToken },
      })
      assert.ok(done.ok, `前置：complete-client 收口失败：${done.status} ${JSON.stringify(done.data).slice(0, 220)}`)

      // ③ pack-done(5→6) → 任务出库(6→7)
      const pd = await http.put(`/api/warehouse-tasks/${t.taskId}/pack-done`, { token, headers: pdaHeaders() })
      assert.ok(pd.ok, `前置：pack-done 失败：${pd.status} ${JSON.stringify(pd.data).slice(0, 220)}`)
      assert.equal(Number((await taskOf(t.taskId)).status), 6, '前置：应进入待出库(6)')

      const shp = await http.put(`/api/warehouse-tasks/${t.taskId}/ship`, { token, headers: pdaHeaders() })
      console.log(`[INFO] 任务出库=${shp.status} ${JSON.stringify(shp.data).slice(0, 200)}`)
      assert.ok(shp.ok, `前置：出库失败：${shp.status} ${JSON.stringify(shp.data).slice(0, 220)}`)

      // ④ 只读核对「已出库」事实：容器被扣空 → EMPTY(2)，且任务锁已释放
      const ctr = await containerOf(t.newI.id)
      const taskAfter = await taskOf(t.taskId)
      console.log(`[INFO] 出库后 取货码 status=${Number(ctr.status)} remaining=${Number(ctr.remaining_qty)} `
        + `locked=${ctr.locked_by_task_id} taskStatus=${Number(taskAfter.status)}`)
      assert.equal(Number(taskAfter.status), 7, '任务应已出库(7)')
      assert.equal(Number(ctr.remaining_qty), 0, '出库后取货码余量应归 0')
      assert.equal(Number(ctr.status), 2, '出库后取货码应为 EMPTY(2)（不是 VOID）')
      assert.equal(ctr.locked_by_task_id, null, '出库后取货码应已解锁')
      const pr = await pickRowsOf(t.taskId, t.newI.id)
      assert.equal(pr.length, 1, '真实 PICK 行应仍在（这是补打取数的唯一来源）')
      assert.notEqual(pr[0].source_container_id, null, '该 PICK 应是真实盒取货')

      // ⑤ 补打取货标签：应成功，且数量取**真实 PICK 行**的 150（不是余量的 0）
      const rep = await reprint(t.newI.id)
      console.log(`[INFO] 已出库后补打=${rep.status} ${JSON.stringify(rep.data).slice(0, 240)}`)
      assert.ok(rep.ok, `已出库的取货码应可补打原取货量：${rep.status} ${JSON.stringify(rep.data).slice(0, 240)}`)
      const repJobId = Number(rep.data?.data?.id)
      assert.ok(repJobId > 0, '补打应留下打印记录')
      const [repJob] = await dbQuery(pool, 'SELECT job_type, ref_id, status FROM print_jobs WHERE id=?', [repJobId])
      assert.equal(repJob.job_type, 'pick_label', '补打必须落取货标签（type 11），不是库存标签')
      assert.equal(Number(repJob.ref_id), Number(t.newI.id), '补打记录应指向该取货码')
      const tpl = require('../backend/src/modules/print-jobs/labelVariables')
      const { vars } = await tpl.readLabelVariables(11, { id: pr[0].id, conn: pool })
      console.log(`[INFO] 已出库补打渲染变量 qty=${vars?.qty}`)
      assert.equal(Number(vars?.qty), 150, '已出库补打的数量应取真实 PICK 的 150，而非余量的 0')
    })

    // ── S6-B 护栏：已取消任务的 free ACTIVE 取货码，补打仍须拒绝（B4 修复保留）────────
    await check('已取消归还后的 free ACTIVE 取货码：补打仍须明确拒绝', async () => {
      const t = await taskWithPickLabel(150)
      assert.ok((await http.post(`/api/sale/${t.saleId}/cancel`, { token })).ok, '前置：取消失败')
      const r = await http.post('/api/scan-logs/cancel-return', {
        token, headers: pdaHeaders(),
        json: { taskId: t.taskId, containerId: Number(t.newI.id), barcode: t.newI.barcode, locationId: location.id },
      })
      assert.ok(r.ok, `前置：归还失败：${JSON.stringify(r.data).slice(0, 200)}`)
      const ctr = await containerOf(t.newI.id)
      assert.equal(ctr.locked_by_task_id, null, '前置：I 应已解锁')
      assert.equal(Number(ctr.status), 1, '前置：I 应仍为 ACTIVE（货还在它上面）')

      const rep = await reprint(t.newI.id)
      console.log(`[INFO] 取消后补打=${rep.status} ${JSON.stringify(rep.data).slice(0, 200)}`)
      assert.ok(!rep.ok, `已取消任务的取货码不得再补打取货标签，实际 ${rep.status} ${JSON.stringify(rep.data).slice(0, 220)}`)
      assert.match(String(rep.data?.message || ''), /任务|归属|进行中/, '拒绝理由应指向「不属于进行中的任务」')
    })

    // ── S6-C 护栏：**取消归还后**的 free ACTIVE 码被下一任务当**普通整件**复用 ⇒ 不得认回旧取货标签 ──
    await check('取消归还后的 free ACTIVE 码被下一任务按普通整件拣（source 为空）：补打不得认旧标签', async () => {
      const a = await taskWithPickLabel(150)
      assert.ok((await http.post(`/api/sale/${a.saleId}/cancel`, { token })).ok, '前置：取消失败')
      const ar = await http.post('/api/scan-logs/cancel-return', {
        token, headers: pdaHeaders(),
        json: { taskId: a.taskId, containerId: Number(a.newI.id), barcode: a.newI.barcode, locationId: location.id },
      })
      assert.ok(ar.ok, `前置：归还失败：${JSON.stringify(ar.data).slice(0, 200)}`)

      await ensureFreeBin()
      const b = await saleToTask(150)
      const picked = await pickScan(b.taskId, b.itemId, a.newI.id, a.newI.barcode, 150, key('pick-b'))
      assert.ok(picked.ok, `前置：整件拣货失败：${JSON.stringify(picked.data).slice(0, 220)}`)
      const bPick = await pickRowsOf(b.taskId, a.newI.id)
      assert.equal(bPick.length, 1, '前置：任务 B 应有拣货行')
      assert.equal(bPick[0].source_container_id, null, '整件拣货的 source_container_id 应为空（不是盒取货）')

      // 该码在任务 B 不是盒取货标签 ⇒ 补打必须拒绝（不得回落到任务 A 的历史取货）
      const rep = await reprint(a.newI.id)
      console.log(`[INFO] 整件复用后补打=${rep.status} ${JSON.stringify(rep.data).slice(0, 200)}`)
      assert.ok(!rep.ok, `普通整件复用的码不得补打旧任务的取货标签，实际 ${rep.status} ${JSON.stringify(rep.data).slice(0, 220)}`)
      assert.match(String(rep.data?.message || ''), /取货|记录|标签/, '拒绝理由应指向缺少本任务的有效盒取货记录')
    })
  } finally {
    let cleaned = 0
    let kept = 0
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
        // 已出库(7) / 已取消(8) 均为**业务终态**：不强行 cancel（发货已完成，单据/库存/账款/打印历史保留），
        // 只登记「终态 + 自身锁 0」。
        if ((st === 7 || st === 8) && locked.length === 0) {
          kept++
          console.log(`[INFO] 收尾保留终态 task ${taskId} status=${st}（不回退、不取消）`)
          continue
        }
        if (st !== 8 && !tk.cancel_requested_at) {
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
        const st2 = Number((await taskOf(taskId)).status)
        const left = Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_containers WHERE locked_by_task_id=?', [taskId]))[0].c ?? -1)
        if (st2 !== 8 || left !== 0) {
          failed++
          console.error(`[FAIL] 收尾核对：task ${taskId} status=${st2} 剩余锁=${left}`)
        } else {
          cleaned++
        }
      } catch (e) {
        failed++
        console.error(`[FAIL] 收尾 sale ${saleId}/task ${taskId} 异常：${e.message}`)
      }
    }
    console.log(`[INFO] 自建销售夹具 ${createdSales.length} 笔：合法收尾 ${cleaned} 笔、保留终态 ${kept} 笔`)

    for (const binId of createdBins) {
      try {
        const r = await http.delete(`/api/sorting-bins/${binId}`, { token })
        if (!r.ok) console.warn(`[WARN] 收尾：自建分拣格 ${binId} 未删除、保留原状：${r.status}`)
      } catch (e) {
        console.warn(`[WARN] 收尾：自建分拣格 ${binId} 删除请求异常、保留原状：${e.message}`)
      }
    }

    if (ownPrint) {
      try { await releaseOwnPackageLabelPrinter(ownPrint, { http, token, assert }) }
      catch (e) { failed++; console.error(`[FAIL] 收尾释放自建打印前提失败：${e.message}`) }
    }
    try { await close() } catch (e) { failed++; console.error(`[FAIL] 关闭测试服务/连接池失败：${e.message}`) }
    try { await require('../backend/src/config/db').pool.end() } catch (e) { failed++; console.error(`[FAIL] 关闭全局连接池失败：${e.message}`) }
  }

  console.log(`\n${'='.repeat(50)}\n  ${passed} passed, ${failed} failed\n${'='.repeat(50)}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error('套件异常终止：', e); process.exitCode = 1 })
