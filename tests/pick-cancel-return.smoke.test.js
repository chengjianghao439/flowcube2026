'use strict'

/**
 * 批 B4 · 取货码的取消 / 减量归还闭环。
 *
 * 断言口径：HTTP 状态码 + **数据库事实**（容器锁定与状态、盒余量、`inventory_stock` 守恒、
 * `scan_logs` / `inventory_logs` 留痕、任务状态与减量登记）。任一项失败即 `process.exitCode = 1`。
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

  /** 保存销售单原始 body，供改单（整单替换语义）复用 */
  let lastSaleBody = null

  async function saleToTask(qty) {
    const sale = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('pb-cancel'),
        items: [{
          productId: Number(product.id), productCode: product.code, productName: product.name,
          unit: product.unit, quantity: qty, unitPrice: 10,
        }],
      },
    })
    assert.equal(sale.status, 201, `建销售单失败：${JSON.stringify(sale.data).slice(0, 200)}`)
    const saleId = Number(sale.data.data.id)
    lastSaleBody = {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      remark: randomRef('pb-adjust'),
      items: [{
        productId: Number(product.id), productCode: product.code, productName: product.name,
        unit: product.unit, quantity: qty, unitPrice: 10,
      }],
    }
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
    const code = `PC${String(randomRef('B')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`
    const created = await http.post('/api/sorting-bins', {
      token, json: { code, warehouseId: Number(warehouse.id), remark: 'pb-cancel' },
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
  const pickQtyOf = async (taskId, containerId) => {
    const rows = await dbQuery(pool,
      'SELECT COALESCE(SUM(qty),0) AS s FROM scan_logs WHERE task_id=? AND container_id=? AND COALESCE(scan_purpose,1)=1',
      [taskId, containerId])
    return Number(rows[0].s)
  }
  const sbiQtyOf = async (taskId) => {
    const rows = await dbQuery(pool, 'SELECT COALESCE(SUM(qty),0) AS s FROM sorting_bin_items WHERE task_id=?', [taskId])
    return Number(rows[0].s)
  }

  const stockQty = async () => {
    const rows = await dbQuery(pool, 'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [product.id, warehouse.id])
    return rows.length ? Number(rows[0].quantity) : 0
  }
  const containerOf = async (id) =>
    (await dbQuery(pool, 'SELECT remaining_qty, status, locked_by_task_id FROM inventory_containers WHERE id=?', [id]))[0]

  /** 真实链造「盒取 150 ⇒ 本任务锁定的新 I(150)」，任务停在拣货中(2) */
  async function taskWithPickLabel(qty) {
    // 分拣格在**进入拣货(2)时**由 on-enter 动作分配：必须先备好空闲格，否则任务永远无格可用
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
    // ── B4-S1 取消整份 150：货在新 I 上、不回盒、库存守恒、留痕 ────────────────
    await check('取消整份 150：新 I 解锁、货不回盒、库存不变、留痕、任务取消', async () => {
      const t = await taskWithPickLabel(150)
      const boxBefore = Number((await containerOf(t.box)).remaining_qty)
      const stockBefore = await stockQty()
      assert.equal(boxBefore, 0, '前置：盒应已取空')

      const c = await http.post(`/api/sale/${t.saleId}/cancel`, { token })
      assert.ok(c.ok, `取消销售单失败：${c.status} ${JSON.stringify(c.data).slice(0, 220)}`)

      const d = await http.get(`/api/warehouse-tasks/${t.taskId}/cancel-return-detail`, { token })
      assert.ok(d.ok, `取取消归还详情失败：${d.status} ${JSON.stringify(d.data).slice(0, 220)}`)

      const r = await http.post('/api/scan-logs/cancel-return', {
        token, headers: pdaHeaders(),
        json: { taskId: t.taskId, containerId: Number(t.newI.id), barcode: t.newI.barcode, locationId: location.id },
      })
      assert.ok(r.ok, `归还扫码失败：${r.status} ${JSON.stringify(r.data).slice(0, 220)}`)

      const newIAfter = await containerOf(t.newI.id)
      assert.equal(newIAfter.locked_by_task_id, null, '新 I 应已解锁')
      assert.equal(Number(newIAfter.status), 1, '新 I 应仍为 ACTIVE（货还在它上面）')
      assert.equal(Number(newIAfter.remaining_qty), 150, '新 I 的货应保持 150')

      // **货不回盒**：盒的余量不因取消而回涨
      assert.equal(Number((await containerOf(t.box)).remaining_qty), boxBefore, '取消不得让盒的余量回涨')

      assert.equal(await stockQty(), stockBefore, '取消不改变库存总量')

      const [tk] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      assert.equal(Number(tk.status), 8, '任务应已取消')

      const logs = await dbQuery(pool,
        'SELECT COUNT(*) AS c FROM inventory_logs WHERE container_id=? AND created_at > NOW() - INTERVAL 2 MINUTE', [t.newI.id])
      assert.ok(Number(logs[0].c) > 0, '取消归还应在 inventory_logs 留痕')
    })

    // ── B4-S2 待证风险：**分拣 150 之后**改单减量到 100，再补拣 50 ──────────────
    // `confirmedPickLabelQty` 用 `SUM(sbi.qty)` + `EXISTS(有效 PICK)`：sbi 记的是**历史**
    // 150，PICK 被减到 100 后 EXISTS 仍为真 ⇒ C 可能仍是 150。先实跑看实际数值。
    await check('分拣 150 后减量到 100：PICK 下调、sbi 保留；补拣 50 后份额不得被历史 150 吞掉', async () => {
      const t = await taskWithPickLabel(150)
      assert.ok((await readyApi(t.taskId)).ok, '前置：ready 失败')
      const [tk] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [t.taskId])
      const sd = await sortDoneRaw(t.taskId, [{ containerId: Number(t.newI.id), binCode: tk.sorting_bin_code }], key('sort'))
      assert.ok(sd.ok, `前置：分拣 150 失败：${JSON.stringify(sd.data).slice(0, 220)}`)
      console.log(`[INFO] 分拣后 PICK=${await pickQtyOf(t.taskId, t.newI.id)} sbi=${await sbiQtyOf(t.taskId)}`)

      // ① 改单：整单替换为 100 ⇒ 任务挂起，等待仓库确认
      const adjustBody = { ...lastSaleBody, items: [{ ...lastSaleBody.items[0], quantity: 100 }] }
      const adj = await http.put(`/api/sale/${t.saleId}/adjust`, { token, json: adjustBody })
      assert.ok(adj.ok, `改单失败：${adj.status} ${JSON.stringify(adj.data).slice(0, 250)}`)

      const [tkAdj] = await dbQuery(pool, 'SELECT status, adjustment_requested_at FROM warehouse_tasks WHERE id=?', [t.taskId])
      console.log(`[INFO] 改单后 task.status=${tkAdj.status} adjustment_requested_at=${tkAdj.adjustment_requested_at}`)
      assert.ok(tkAdj.adjustment_requested_at, '改单后任务应处于挂起（adjustment_requested_at 非空）')

      // ② 仓库端确认：先从「改单确认」任务池拿到本任务的 **adjustment id**，再取详情
      const pending = await http.get('/api/warehouse-tasks/adjustments/pending', { token })
      assert.ok(pending.ok, `改单任务池失败：${pending.status} ${JSON.stringify(pending.data).slice(0, 250)}`)
      const adjPool = pending.data?.data?.list ?? pending.data?.data ?? []
      console.log(`[INFO] 改单任务池=${JSON.stringify(adjPool).slice(0, 300)}`)
      // 任务池项里 `id` 是 **taskId**，`adjustmentId` 才是详情接口要的 id
      const mine = (Array.isArray(adjPool) ? adjPool : []).find(x => Number(x.id) === t.taskId)
      assert.ok(mine, '改单任务池应包含本任务')
      assert.ok(mine.adjustmentId, '任务池项应含 adjustmentId')

      const detail = await http.get(`/api/warehouse-tasks/adjustments/${mine.adjustmentId}`, { token })
      assert.ok(detail.ok, `改单详情失败：${detail.status} ${JSON.stringify(detail.data).slice(0, 250)}`)
      const detItems = detail.data?.data?.items ?? []
      const returns = detItems.flatMap(i => i.containerReturns ?? [])
      console.log(`[INFO] 待归还=${JSON.stringify(returns).slice(0, 400)}`)
      for (const r of returns) {
        const cf = await http.post(`/api/warehouse-tasks/adjustments/container-returns/${r.id}/confirm`, {
          token, headers: pdaHeaders(), json: { targetLocationId: location.id },
        })
        assert.ok(cf.ok, `确认归还失败：${cf.status} ${JSON.stringify(cf.data).slice(0, 220)}`)
      }

      const pickAfter = await pickQtyOf(t.taskId, t.newI.id)
      const sbiAfter = await sbiQtyOf(t.taskId)
      console.log(`[INFO] 减量确认后 PICK=${pickAfter} sbi=${sbiAfter}`)
      assert.ok(pickAfter <= 100, `PICK 应已下调到 <=100，实际 ${pickAfter}`)
      // 历史作业记录**保留原样**（实测仍为 150）：减量不改写作业记录，改的是「有效量」的读法
      assert.equal(sbiAfter, 150, `历史 sbi 应保留为 150，实际 ${sbiAfter}`)

      // ③ 取证后续数量状态：sorted_qty 是否随减量下调？任务回到哪一步？
      const [item] = await dbQuery(pool,
        'SELECT required_qty, picked_qty, sorted_qty, checked_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      const [tkAfter] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      console.log(`[INFO] 减量后 required=${Number(item.required_qty)} picked=${Number(item.picked_qty)} sorted=${Number(item.sorted_qty)} checked=${Number(item.checked_qty)} taskStatus=${Number(tkAfter.status)}`)

      // ⑤ 增量回 150（改单整单替换）——增量路径通常会回退到「拣货中」等待补拣
      const incBody = { ...lastSaleBody, items: [{ ...lastSaleBody.items[0], quantity: 150 }] }
      const inc = await http.put(`/api/sale/${t.saleId}/adjust`, { token, json: incBody })
      assert.ok(inc.ok, `增量改单失败：${inc.status} ${JSON.stringify(inc.data).slice(0, 250)}`)

      // 增量可能也产生待归还/待处理项：若有就逐条走确认
      const pending2 = await http.get('/api/warehouse-tasks/adjustments/pending', { token })
      const pool2 = pending2.data?.data?.list ?? pending2.data?.data ?? []
      const mine2 = (Array.isArray(pool2) ? pool2 : []).find(x => Number(x.id) === t.taskId)
      if (mine2) {
        const det2 = await http.get(`/api/warehouse-tasks/adjustments/${mine2.adjustmentId}`, { token })
        const rets2 = (det2.data?.data?.items ?? []).flatMap(i => i.containerReturns ?? [])
        for (const r of rets2) {
          const cf = await http.post(`/api/warehouse-tasks/adjustments/container-returns/${r.id}/confirm`, {
            token, headers: pdaHeaders(), json: { targetLocationId: location.id },
          })
          assert.ok(cf.ok, `增量侧确认失败：${cf.status} ${JSON.stringify(cf.data).slice(0, 220)}`)
        }
      }
      const [tkInc] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      const [itemInc] = await dbQuery(pool, 'SELECT required_qty, picked_qty, sorted_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      console.log(`[INFO] 增量后 taskStatus=${Number(tkInc.status)} required=${Number(itemInc.required_qty)} picked=${Number(itemInc.picked_qty)} sorted=${Number(itemInc.sorted_qty)}`)

      // ⑥ 补拣盒 50（新盒取 50 ⇒ 新 I(50)）
      const src2 = await makeWholeContainer(200)
      const box2 = await createEmptyBox()
      assert.equal((await fillReq(box2, src2, key('fill2'))).status, 200, '前置：补拣用盒放货失败')
      const boxBarcode2 = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box2]))[0].barcode
      const picked2 = await pickScan(t.taskId, t.itemId, box2, boxBarcode2, 50, key('pick2'))
      assert.ok(picked2.ok, `补拣失败：${picked2.status} ${JSON.stringify(picked2.data).slice(0, 220)}`)
      const [newI2] = await dbQuery(pool,
        "SELECT id, barcode FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1",
        [box2])
      assert.ok(newI2, '补拣应生成新 I')
      const pickTotal = await pickQtyOf(t.taskId, newI2.id)
      console.log(`[INFO] 补拣后新 I 的有效 PICK=${pickTotal}`)

      // ⑦ ready → 真实 sort-done：**复现**新标签会不会被历史 sbi 挡住
      assert.ok((await readyApi(t.taskId)).ok, '前置：补拣后 ready 失败')
      const [tk3] = await dbQuery(pool, 'SELECT status, sorting_bin_code FROM warehouse_tasks WHERE id=?', [t.taskId])
      assert.equal(Number(tk3.status), 3, '前置：任务应回到待分拣(3)')
      const sdNew = await sortDoneRaw(t.taskId, [{ containerId: Number(newI2.id), binCode: tk3.sorting_bin_code }], key('sort-new'))
      console.log(`[INFO] 补拣标签 sort-done=${sdNew.status} ${JSON.stringify(sdNew.data).slice(0, 220)}`)
      assert.ok(sdNew.ok, `补拣的新标签应能分拣（历史 sbi 不得吞掉它）：${sdNew.status} ${JSON.stringify(sdNew.data).slice(0, 250)}`)
      const [itemAfterSort] = await dbQuery(pool, 'SELECT picked_qty, sorted_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      assert.equal(Number(itemAfterSort.sorted_qty), Number(itemAfterSort.picked_qty), '分拣后 sorted 应等于 picked（150）')

      // ⑧ **真实复核闭合**：扫全部锁定容器 ⇒ 任务进入待打包(5)
      const locked = await dbQuery(pool, 'SELECT id, barcode FROM inventory_containers WHERE locked_by_task_id=?', [t.taskId])
      console.log(`[INFO] 复核前锁定容器=${JSON.stringify((locked || []).map(c => c.barcode))}`)
      for (const c of locked) {
        const cr = await checkScan(t.taskId, c.barcode, key('chk'))
        assert.ok(cr.ok, `复核 ${c.barcode} 失败：${cr.status} ${JSON.stringify(cr.data).slice(0, 220)}`)
      }
      const [tk5] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      assert.equal(Number(tk5.status), 5, '复核闭合后应进入待打包(5)')

      // ⑨ **真实装箱**：补拣的标签整份入箱 50（验证配额口径在减量+补拣后仍正确）
      const pkg = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: t.taskId } })
      assert.ok(pkg.ok, `建箱失败：${pkg.status} ${JSON.stringify(pkg.data).slice(0, 220)}`)
      const pkgId = Number(pkg.data.data.id)
      const add = await http.post(`/api/packages/${pkgId}/add-item`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add') },
        json: { labelBarcode: newI2.barcode },
      })
      assert.ok(add.ok, `装箱失败：${add.status} ${JSON.stringify(add.data).slice(0, 250)}`)
      assert.equal(Number(add.data.data.qty), 50, '补拣标签应整份入箱 50')
      assert.equal(Number(add.data.data.labelBarcode ? 1 : 0), 1, '回执应带原条码用于定位')

      // ⑩ **旧码按标签合法入箱其当前有效 100**，两来源合计 150；
      //    并验证旧 SKU（商品码）路径**不能吞掉**被标签占住的份额
      const addOld = await http.post(`/api/packages/${pkgId}/add-item`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add-old') },
        json: { labelBarcode: t.newI.barcode },
      })
      assert.ok(addOld.ok, `旧码入箱失败：${addOld.status} ${JSON.stringify(addOld.data).slice(0, 250)}`)
      assert.equal(Number(addOld.data.data.qty), 100, '旧码应整份入箱其**当前有效量** 100（不是历史 150）')

      const [sumRow] = await dbQuery(pool,
        'SELECT COALESCE(SUM(qty),0) AS s FROM package_items WHERE package_id=?', [pkgId])
      assert.equal(Number(sumRow.s), 150, '两来源合计应为 150')

      // 旧 SKU 路径只能装「未被标签占住」的份额：此处 checked=150、标签已占 150 ⇒ 可装 0
      const legacyTry = await http.post(`/api/packages/${pkgId}/add-item`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add-legacy') },
        json: { productCode: product.code, qty: 1 },
      })
      assert.ok(!legacyTry.ok, `旧 SKU 不得吞标签份额，实际 ${legacyTry.status} ${JSON.stringify(legacyTry.data).slice(0, 220)}`)

      // ⑪ 减量后**旧取货码补打**：数量取「当前有效」100（分层记录：入队成功与记录里的量）
      const rep = await http.post('/api/print-jobs/barcodes/reprint', {
        token, json: { category: 'inbound', recordId: Number(t.newI.id) },
      })
      assert.ok(rep.ok, `旧码补打应成功（仍锁定于本任务）：${rep.status} ${JSON.stringify(rep.data).slice(0, 220)}`)
      const repJobId = Number(rep.data?.data?.id)
      const [repJob] = await dbQuery(pool, 'SELECT id, status, job_type FROM print_jobs WHERE id=?', [repJobId])
      console.log(`[INFO] 补打记录 job=${repJobId} jobType=${repJob?.job_type} status=${repJob?.status}（成功入队≠实际出纸）`)
      assert.ok(repJob, '补打应留下打印记录')
      // 变量取自**当前有效 PICK 行**：数量应为 100 而不是历史 150
      const [slRow] = await dbQuery(pool,
        `SELECT id FROM scan_logs
          WHERE task_id=? AND container_id=? AND COALESCE(scan_purpose,1)=1 AND source_container_id IS NOT NULL
          ORDER BY id DESC LIMIT 1`,
        [t.taskId, t.newI.id])
      assert.ok(slRow, '应有当前有效 PICK 行')
      const tpl = require('../backend/src/modules/print-jobs/labelVariables')
      const { vars } = await tpl.readLabelVariables(11, { id: slRow.id, conn: pool })
      console.log(`[INFO] 补打渲染变量 qty=${vars?.qty}（成功入队与记录≠实际出纸）`)
      assert.equal(Number(vars?.qty), 100, '补打标签数量应取当前有效 100，而非历史 150')
    })

    // ── B4-S3 取消归还后的码被下一任务当**普通整件**再拣 ⇒ 不得当本任务盒取货标签 ──
    await check('取消归还后的整件码在下一任务按普通整件拣：source_container_id 为空 ⇒ 取货码形态分拣被拒', async () => {
      // ① 任务 A 造新 I(150) 并取消归还 ⇒ I 变 free ACTIVE
      const a = await taskWithPickLabel(150)
      assert.ok((await http.post(`/api/sale/${a.saleId}/cancel`, { token })).ok, '前置：取消失败')
      const ar = await http.post('/api/scan-logs/cancel-return', {
        token, headers: pdaHeaders(),
        json: { taskId: a.taskId, containerId: Number(a.newI.id), barcode: a.newI.barcode, locationId: location.id },
      })
      assert.ok(ar.ok, `前置：归还失败：${JSON.stringify(ar.data).slice(0, 200)}`)
      assert.equal((await containerOf(a.newI.id)).locked_by_task_id, null, '前置：I 应已解锁')

      // ② 任务 B：把同一只 I 当**普通整件**拣（不是盒取货）
      await ensureFreeBin()
      const b = await saleToTask(150)
      const picked = await pickScan(b.taskId, b.itemId, a.newI.id, a.newI.barcode, 150, key('pick-b'))
      assert.ok(picked.ok, `前置：整件拣货失败：${JSON.stringify(picked.data).slice(0, 220)}`)
      const bPick = await dbQuery(pool,
        'SELECT source_container_id FROM scan_logs WHERE task_id=? AND container_id=? AND COALESCE(scan_purpose,1)=1',
        [b.taskId, a.newI.id])
      assert.equal(bPick.length, 1, '前置：应有拣货行')
      assert.equal(bPick[0].source_container_id, null, '整件拣货的 source_container_id 应为空（不是盒取货）')

      // ③ 该码在任务 B **不是**盒取货标签 ⇒ 取货码形态分拣必须被拒
      assert.ok((await readyApi(b.taskId)).ok, '前置：ready 失败')
      const [btk] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [b.taskId])
      const r = await sortDoneRaw(b.taskId, [{ containerId: Number(a.newI.id), binCode: btk.sorting_bin_code }], key('sort-b'))
      assert.ok(!r.ok, `非盒取货的整件码不得按取货码分拣，实际 ${r.status} ${JSON.stringify(r.data).slice(0, 220)}`)
      assert.match(String(r.data?.message || ''), /取货|盒/, '拒绝理由应指向缺少真实的盒取货记录')

      // ④ **复用闭环继续**：该码在任务 B 走**普通整件**全链 —— 商品码分拣 → 真实复核 → 商品码装箱。
      //    只验「取货码形态被拒」不等于复用闭环完成，必须证明合法路径仍能走完。
      const sdLegacy = await sortDoneRaw(b.taskId, [{ itemId: b.itemId, sortedQty: 150 }], key('sort-legacy'))
      assert.ok(sdLegacy.ok, `商品码分拣失败：${sdLegacy.status} ${JSON.stringify(sdLegacy.data).slice(0, 250)}`)
      const [bItem] = await dbQuery(pool, 'SELECT picked_qty, sorted_qty FROM warehouse_task_items WHERE id=?', [b.itemId])
      assert.equal(Number(bItem.sorted_qty), Number(bItem.picked_qty), '商品码分拣后 sorted 应等于 picked（150）')

      const bLocked = await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE locked_by_task_id=?', [b.taskId])
      for (const c of bLocked) {
        const cr = await checkScan(b.taskId, c.barcode, key('chk-b'))
        assert.ok(cr.ok, `任务 B 复核 ${c.barcode} 失败：${cr.status} ${JSON.stringify(cr.data).slice(0, 220)}`)
      }
      const [btk5] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [b.taskId])
      assert.equal(Number(btk5.status), 5, '任务 B 复核闭合后应进入待打包(5)')

      const bpkg = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: b.taskId } })
      assert.ok(bpkg.ok, `任务 B 建箱失败：${bpkg.status} ${JSON.stringify(bpkg.data).slice(0, 220)}`)
      const bpkgId = Number(bpkg.data.data.id)
      const bAdd = await http.post(`/api/packages/${bpkgId}/add-item`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add-b') },
        json: { productCode: product.code, qty: 150 },
      })
      assert.ok(bAdd.ok, `商品码装箱 150 失败：${bAdd.status} ${JSON.stringify(bAdd.data).slice(0, 250)}`)
      assert.equal(Number(bAdd.data.data.qty), 150, '商品码应能整份装箱 150（合法整件链走完）')
      assert.equal(bAdd.data.data.labelContainerId, null, '商品码装箱不应带来源取货标签')
    })

    // ── B4-S4 补打：取消后原任务不得再认这只 I 为自己的取货标签 ────────────────
    await check('取消归还后原任务补打该码被明确拒绝（按当前有效 PICK 归属，不认历史 source_ref_type）', async () => {
      const t = await taskWithPickLabel(150)
      assert.ok((await http.post(`/api/sale/${t.saleId}/cancel`, { token })).ok, '前置：取消失败')
      const rr = await http.post('/api/scan-logs/cancel-return', {
        token, headers: pdaHeaders(),
        json: { taskId: t.taskId, containerId: Number(t.newI.id), barcode: t.newI.barcode, locationId: location.id },
      })
      assert.ok(rr.ok, `前置：归还失败：${JSON.stringify(rr.data).slice(0, 200)}`)

      const rep = await http.post('/api/print-jobs/barcodes/reprint', {
        token, json: { category: 'inbound', recordId: Number(t.newI.id) },
      })
      assert.ok(!rep.ok, `原任务取消后不得再补打该取货标签，实际 ${rep.status} ${JSON.stringify(rep.data).slice(0, 220)}`)
    })

    // ── B4-S5 同箱同 SKU 多标签 → finish 打印链 → 合法性减量（作废已完成箱 + 归还）──
    await check('同箱同 SKU 两张标签经 finish 打印链后减量 150→100：作废箱与归还走受控流程', async () => {
      // ① 造任务：同一盒取 60 + 90（同 SKU 两张标签）
      const src = await makeWholeContainer(200)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      await ensureFreeBin()
      const t = await saleToTask(150)
      assert.ok((await pickScan(t.taskId, t.itemId, box, boxBarcode, 60, key('p1'))).ok, '前置：取 60 失败')
      assert.ok((await pickScan(t.taskId, t.itemId, box, boxBarcode, 90, key('p2'))).ok, '前置：取 90 失败')
      const picks = await dbQuery(pool,
        "SELECT id, barcode FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id ASC", [box])
      assert.equal(picks.length, 2, '前置：应有两张取货码')

      // ② ready → 分拣两张 → 真实复核 → 待打包(5)
      assert.ok((await readyApi(t.taskId)).ok, '前置：ready 失败')
      const [tk0] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [t.taskId])
      for (let i = 0; i < picks.length; i++) {
        assert.ok((await sortDoneRaw(t.taskId, [{ containerId: Number(picks[i].id), binCode: tk0.sorting_bin_code }], key('s' + i))).ok, `前置：分拣第 ${i + 1} 张失败`)
      }
      for (const c of picks) assert.ok((await checkScan(t.taskId, c.barcode, key('chk'))).ok, `前置：复核 ${c.barcode} 失败`)
      const [tk5] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      assert.equal(Number(tk5.status), 5, '前置：应进入待打包(5)')

      // ③ **同一个箱**装两张同 SKU 标签 ⇒ 两行
      const pkg = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: t.taskId } })
      assert.ok(pkg.ok, `前置：建箱失败：${JSON.stringify(pkg.data).slice(0, 220)}`)
      const pkgId = Number(pkg.data.data.id)
      for (const c of picks) {
        const add = await http.post(`/api/packages/${pkgId}/add-item`, {
          token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add') }, json: { labelBarcode: c.barcode },
        })
        assert.ok(add.ok, `前置：标签 ${c.barcode} 入箱失败：${JSON.stringify(add.data).slice(0, 220)}`)
      }
      const [rowAgg] = await dbQuery(pool,
        'SELECT COALESCE(SUM(qty),0) AS s, COUNT(*) AS c FROM package_items WHERE package_id=?', [pkgId])
      console.log(`[INFO] 同箱两标签：行数=${Number(rowAgg.c)} 合计=${Number(rowAgg.s)}`)
      assert.equal(Number(rowAgg.c), 2, '同 SKU 不同来源应各成一行')
      assert.equal(Number(rowAgg.s), 150, '同箱合计应为 150')

      // ④ finish：走既有打印链（入队成功 ≠ 实际出纸）
      const fin = await http.put(`/api/packages/${pkgId}/finish`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('fin') },
      })
      console.log(`[INFO] finish=${fin.status} ${JSON.stringify(fin.data).slice(0, 240)}`)
      assert.ok(fin.ok, `finish 失败：${fin.status} ${JSON.stringify(fin.data).slice(0, 250)}`)
      const [pkgAfter] = await dbQuery(pool, 'SELECT status FROM packages WHERE id=?', [pkgId])
      assert.equal(Number(pkgAfter.status), 2, 'finish 后箱应为已完成')

      // ⑤ 合法减量 150 → 100 ⇒ 应产生 packageVoids（作废已完成箱腾容量）+ 归还需
      const adjBody = { ...lastSaleBody, items: [{ ...lastSaleBody.items[0], quantity: 100 }] }
      const adj = await http.put(`/api/sale/${t.saleId}/adjust`, { token, json: adjBody })
      assert.ok(adj.ok, `减量改单失败：${adj.status} ${JSON.stringify(adj.data).slice(0, 250)}`)

      const pending = await http.get('/api/warehouse-tasks/adjustments/pending', { token })
      const poolList = pending.data?.data?.list ?? pending.data?.data ?? []
      const mine = (Array.isArray(poolList) ? poolList : []).find(x => Number(x.id) === t.taskId)
      assert.ok(mine, '减量任务应进入改单确认池')
      const detail = await http.get(`/api/warehouse-tasks/adjustments/${mine.adjustmentId}`, { token })
      const detItems = detail.data?.data?.items ?? []
      const voids = detItems.flatMap(i => i.packageVoids ?? [])
      const rets = detItems.flatMap(i => i.containerReturns ?? [])
      console.log(`[INFO] 减量待处理：packageVoids=${JSON.stringify(voids).slice(0, 200)} containerReturns=${JSON.stringify(rets).slice(0, 200)}`)
      assert.ok(voids.length > 0, '已完成箱应进入 package-void 受控确认（腾容量）')

      // 受控拆箱确认
      for (const v of voids) {
        const cf = await http.post(`/api/warehouse-tasks/adjustments/package-voids/${v.id}/confirm`, {
          token, headers: pdaHeaders(), json: {},
        })
        assert.ok(cf.ok, `确认拆箱失败：${cf.status} ${JSON.stringify(cf.data).slice(0, 220)}`)
      }
      // 归还确认
      for (const r of rets) {
        const cf = await http.post(`/api/warehouse-tasks/adjustments/container-returns/${r.id}/confirm`, {
          token, headers: pdaHeaders(), json: { targetLocationId: location.id },
        })
        assert.ok(cf.ok, `确认归还失败：${cf.status} ${JSON.stringify(cf.data).slice(0, 220)}`)
      }

      const [pkgVoided] = await dbQuery(pool, 'SELECT status FROM packages WHERE id=?', [pkgId])
      const [itemNow] = await dbQuery(pool, 'SELECT required_qty, picked_qty FROM warehouse_task_items WHERE id=?', [t.itemId])
      const [tkNow] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      console.log(`[INFO] 减量确认后 pkgStatus=${Number(pkgVoided.status)} required=${Number(itemNow.required_qty)} picked=${Number(itemNow.picked_qty)} taskStatus=${Number(tkNow.status)}`)
      assert.equal(Number(itemNow.required_qty), 100, '减量后需求应为 100')

      // ⑥ 闭环收尾：减量后**重新复核**（checked 已清零）⇒ 回到待打包(5)
      const lockedNow = await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE locked_by_task_id=?', [t.taskId])
      for (const c of lockedNow) {
        const cr = await checkScan(t.taskId, c.barcode, key('chk2'))
        assert.ok(cr.ok, `减量后复核 ${c.barcode} 失败：${cr.status} ${JSON.stringify(cr.data).slice(0, 220)}`)
      }
      const [tkP] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [t.taskId])
      assert.equal(Number(tkP.status), 5, '减量后重新复核闭合应回到待打包(5)')

      // ⑦ **完整闭合**：把**所有仍锁本任务、有效 PICK 非空且已完成复核**的标签分别装新箱，
      //    装到非作废箱合计 = 新的配额 min(required 100, checked) = 100 为止。
      //    只装第一张**不能**称「已重新装完」——减量按 FIFO 扣减，各标签剩余量不等。
      const lockedLabels = await dbQuery(pool,
        `SELECT c.id, c.barcode
         FROM inventory_containers c
         WHERE c.locked_by_task_id = ? AND c.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM scan_logs sl
                       WHERE sl.task_id = ? AND sl.container_id = c.id
                         AND COALESCE(sl.scan_purpose,1) = 1 AND sl.source_container_id IS NOT NULL)
           AND EXISTS (SELECT 1 FROM scan_logs sc
                       WHERE sc.task_id = ? AND sc.container_id = c.id AND sc.scan_purpose = 2)
         ORDER BY c.id ASC`,
        [t.taskId, t.taskId, t.taskId])
      console.log(`[INFO] 可重装标签=${JSON.stringify(lockedLabels.map(c => c.barcode))}`)
      assert.ok(lockedLabels.length > 0, '应仍有可重装的标签')

      let remainToPack = 100
      let packedTotal = 0
      for (const c of lockedLabels) {
        if (remainToPack <= 0) break
        const [slx] = await dbQuery(pool,
          `SELECT COALESCE(SUM(qty),0) AS s FROM scan_logs
            WHERE task_id=? AND container_id=? AND COALESCE(scan_purpose,1)=1 AND source_container_id IS NOT NULL`,
          [t.taskId, c.id])
        const avail = Number(slx.s)
        const take = Math.min(avail, remainToPack)
        if (take <= 0) continue
        const p = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: t.taskId } })
        assert.ok(p.ok, `重新建箱失败：${p.status} ${JSON.stringify(p.data).slice(0, 220)}`)
        const pid = Number(p.data.data.id)
        const add = await http.post(`/api/packages/${pid}/add-item`, {
          token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add2') },
          json: { labelBarcode: c.barcode, qty: take },
        })
        assert.ok(add.ok, `重装标签 ${c.barcode} 失败：${add.status} ${JSON.stringify(add.data).slice(0, 220)}`)
        assert.equal(Number(add.data.data.qty), take, `应按 ${take} 装入`)
        packedTotal += take
        remainToPack -= take
      }
      assert.equal(packedTotal, 100, '应把 100 全部重新装完（而不是只装第一张）')

      // 非作废箱合计 = 100
      const [sumNew] = await dbQuery(pool,
        `SELECT COALESCE(SUM(pi.qty),0) AS s FROM package_items pi
         JOIN packages p ON p.id = pi.package_id
         WHERE p.warehouse_task_id = ? AND p.status != 3`, [t.taskId])
      assert.equal(Number(sumNew.s), 100, `非作废箱合计应为 100，实际 ${Number(sumNew.s)}`)

      // 旧箱保持作废；PICK 合计 100；**历史 sbi 不被改写**
      const [oldPkg] = await dbQuery(pool, 'SELECT status FROM packages WHERE id=?', [pkgId])
      assert.equal(Number(oldPkg.status), 3, '旧箱应保持已作废')
      const [pickSum] = await dbQuery(pool,
        'SELECT COALESCE(SUM(qty),0) AS s FROM scan_logs WHERE task_id=? AND COALESCE(scan_purpose,1)=1 AND source_container_id IS NOT NULL',
        [t.taskId])
      assert.equal(Number(pickSum.s), 100, 'PICK 合计应为 100')
      const sbiRows = await dbQuery(pool, 'SELECT qty FROM sorting_bin_items WHERE task_id=? ORDER BY id', [t.taskId])
      const sbiVals = sbiRows.map(r => Number(r.qty)).sort((a, b) => a - b)
      assert.deepEqual(sbiVals, [60, 90], `历史 sbi 不得被改写，应仍为 [60,90]，实际 ${JSON.stringify(sbiVals)}`)

      // 容器库存合计与库存缓存守恒
      const [ctrSum] = await dbQuery(pool,
        `SELECT COALESCE(SUM(remaining_qty),0) AS s FROM inventory_containers
          WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL`,
        [product.id, warehouse.id])
      console.log(`[INFO] ACTIVE 容器余量合计=${Number(ctrSum.s)} 库存缓存=${await stockQty()}`)
      assert.equal(Number(ctrSum.s), Number(await stockQty()), 'ACTIVE 容器余量合计应与库存缓存一致（守恒）')
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
