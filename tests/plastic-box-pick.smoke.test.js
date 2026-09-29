'use strict'

/**
 * 批 B1 · 扫盒取货：从塑料盒 `B` 转出到**本任务锁定的新 `I`**（销售取货独立身份）。
 *
 * 断言口径：HTTP 状态码 + **数据库库存事实**（盒余量、新 `I` 的锁定与余量、`scan_logs`
 * 的 container_id/source_container_id、`inventory_stock` 守恒、打印记录用途）。
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

// ── 渲染失败注入（**默认透传真实实现**，仅「渲染失败」用例临时打开）────────────
// 必须在 backend 首次 require 这两个模块**之前**打桩：label-command 对它们是解构导入。
const nodePath = require('node:path')
const PB_ROOT = nodePath.resolve(__dirname, '..')
const rasterPath = require.resolve(nodePath.join(PB_ROOT, 'backend/src/modules/print-jobs/labelRasterService'))
const realRaster = require(rasterPath)
require.cache[rasterPath].exports = {
  ...realRaster,
  renderLabelAsync: async (input) => {
    if (globalThis.__PB_FORCE_RENDER_FAIL__) {
      const e = new Error('标签绘制繁忙，请稍后重试')
      e.code = 'LABEL_RENDER_BUSY'
      throw e
    }
    return realRaster.renderLabelAsync(input)
  },
}
const tplPathForPick = require.resolve(nodePath.join(PB_ROOT, 'backend/src/modules/print-jobs/labelZplTemplate'))
const realTplForPick = require(tplPathForPick)
require.cache[tplPathForPick].exports = {
  ...realTplForPick,
  getLabelZplFromDefaultTemplate: async (t, v) =>
    globalThis.__PB_FORCE_RENDER_FAIL__ ? null : realTplForPick.getLabelZplFromDefaultTemplate(t, v),
}

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
  const containerOf = async (id) =>
    (await dbQuery(pool, 'SELECT remaining_qty, status, is_mixed_batch, batch_no, exp_date, locked_by_task_id FROM inventory_containers WHERE id=?', [id]))[0]
  const stockQty = async () => {
    const rows = await dbQuery(pool, 'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [product.id, warehouse.id])
    return rows.length ? Number(rows[0].quantity) : 0
  }

  /** 真实链造整件（采购→收货→上架） */
  async function makeWholeContainer(qty, opts = {}) {
    const po = await createPurchaseOrder(http, token, { supplier, warehouse, product, quantity: qty })
    assert.equal(po.status, 201, `采购单创建失败：${JSON.stringify(po.data).slice(0, 200)}`)
    const poId = po.data.data.id
    assert.equal((await confirmPurchaseOrder(http, token, poId)).status, 200, '采购确认失败')
    const it = await createInboundTaskFromPurchase(http, token, poId)
    assert.equal(it.status, 201, `入库任务创建失败：${JSON.stringify(it.data).slice(0, 200)}`)
    const taskId = it.data.data.taskId ?? it.data.data.id
    assert.equal((await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })).status, 200, '入库提交失败')
    const body = { productId: product.id, qty }
    if (opts.batchNo) body.batchNo = opts.batchNo
    if (opts.expDate) body.expDate = opts.expDate
    const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, { token, headers: pdaHeaders(), json: body })
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

  /** 真实链造「本仓的拣货任务」：销售单 → 占库 → 发货（生成任务） */
  async function saleToTask(qty) {
    const sale = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('pb-pick'),
        items: [{
          productId: Number(product.id), productCode: product.code, productName: product.name,
          unit: product.unit, quantity: qty, unitPrice: 10,
        }],
      },
    })
    assert.equal(sale.status, 201, `建销售单失败：${JSON.stringify(sale.data).slice(0, 200)}`)
    const saleId = Number(sale.data.data.id)
    // **创建成功即登记**：此后 reserve / ship 若失败，finally 仍能按该 ID 合法取消并收尾
    createdSales.push({ saleId, taskId: null })
    assert.equal((await http.post(`/api/sale/${saleId}/reserve`, { token })).status, 200, '占库失败')
    const ship = await http.post(`/api/sale/${saleId}/ship`, { token })
    assert.ok(ship.ok, `发货(生成任务)失败：${JSON.stringify(ship.data).slice(0, 200)}`)
    const [so] = await dbQuery(pool, 'SELECT task_id FROM sale_orders WHERE id=?', [saleId])
    const taskId = Number(so.task_id)
    const [wti] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=? ORDER BY id LIMIT 1', [taskId])
    // 回填 taskId（供 finally 走取消 + 归还；未回填的按「只有销售单」处理）
    createdSales[createdSales.length - 1].taskId = taskId
    return { saleId, taskId, itemId: Number(wti.id) }
  }

  const pickScan = (taskId, itemId, containerId, barcode, qty, k) =>
    http.post('/api/scan-logs', {
      token,
      headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) },
      json: { taskId, itemId, containerId, barcode, productId: Number(product.id), qty, scanMode: '整件' },
    })

  try {
    // ── B1-S1 核心：扫盒取货生成**本任务锁定的新 I** ────────────────────────
    await check('扫盒取 150：盒 200→50、生成锁定本任务的新 I(150)、PICK 只落新 I 且 source_container_id=盒', async () => {
      const src = await makeWholeContainer(200)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      assert.equal(Number((await containerOf(box)).remaining_qty), 200, '前置：盒应为 200')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const beforeStock = await stockQty()

      const sale = await saleToTask(150)
      const r = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 150, key('pick'))
      assert.ok(r.ok, `扫盒取货失败：${JSON.stringify(r.data).slice(0, 250)}`)

      // ① 盒减到 50（**旧码只锁不减** ⇒ 此断言在旧码上失败）
      assert.equal(Number((await containerOf(box)).remaining_qty), 50, '盒余量应减到 50')

      // ② 生成新 I(150) 且已锁给本任务
      const [newI] = await dbQuery(
        pool,
        "SELECT id, barcode, remaining_qty, locked_by_task_id, container_type FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1",
        [box],
      )
      assert.ok(newI, '应生成新 I（source_ref_type=plastic_box_pick）')
      assert.equal(Number(newI.remaining_qty), 150, '新 I 应为 150')
      assert.equal(Number(newI.container_type), 1, '新 I 的 container_type 应为 1')
      assert.equal(Number(newI.locked_by_task_id), sale.taskId, '新 I 应锁定给本任务')

      // ③ PICK 只落新 I；source_container_id 指向盒（**旧码落 B 且无该列** ⇒ 旧码失败）
      const [sl] = await dbQuery(
        pool,
        'SELECT container_id, source_container_id, barcode FROM scan_logs WHERE task_id=? ORDER BY id DESC LIMIT 1',
        [sale.taskId],
      )
      assert.equal(Number(sl.container_id), Number(newI.id), 'PICK 行应指向新 I')
      assert.equal(Number(sl.source_container_id), Number(box), 'source_container_id 应指向盒')

      // ④ 库存总量守恒（货只是换了容器）
      assert.equal(await stockQty(), beforeStock, '取货不改变库存总量')
    })

    // ── B1-S2 同键重放：返回原回执，不新增新 I、不二次扣盒 ────────────────────
    await check('扫盒取货同键重放：成功返回原回执，且不新增新 I、不再次扣减盒', async () => {
      const src = await makeWholeContainer(100)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(60)
      const k = key('pick-replay')

      const r1 = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 60, k)
      assert.ok(r1.ok, `首次取货失败：${JSON.stringify(r1.data).slice(0, 200)}`)
      const boxAfterFirst = Number((await containerOf(box)).remaining_qty)
      const countNewI = async () =>
        Number((await dbQuery(pool,
          "SELECT COUNT(*) c FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=?",
          [box]))[0].c)
      const n1 = await countNewI()

      const r2 = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 60, k)
      assert.ok(r2.ok, `同键重放应成功：${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.equal(await countNewI(), n1, '同键重放不得新增新 I')
      assert.equal(Number((await containerOf(box)).remaining_qty), boxAfterFirst, '同键重放不得再次扣减盒')
    })

    // ── B1-S3 合法第二次取货（新键）：新 I，盒继续扣减；不被历史 SUM / 5 秒挡 ──
    await check('合法第二次取货（新键）：再生成一个新 I 且盒继续扣减（不被历史 SUM / 5 秒挡）', async () => {
      const src = await makeWholeContainer(200)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(150)

      const p1 = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 80, key('p1'))
      assert.ok(p1.ok, `第一次取货失败：${JSON.stringify(p1.data).slice(0, 200)}`)
      assert.equal(Number((await containerOf(box)).remaining_qty), 120, '第一次后盒应为 120')

      const p2 = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 70, key('p2'))
      assert.ok(p2.ok, `第二次取货不得被历史 SUM / 5 秒挡：${JSON.stringify(p2.data).slice(0, 200)}`)
      assert.equal(Number((await containerOf(box)).remaining_qty), 50, '第二次后盒应为 50')

      const cnt = Number((await dbQuery(pool,
        "SELECT COUNT(*) c FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=?",
        [box]))[0].c)
      assert.equal(cnt, 2, '两次取货应各生成一个新 I（不复用）')
      const [picked] = await dbQuery(pool, 'SELECT picked_qty FROM warehouse_task_items WHERE id=?', [sale.itemId])
      assert.equal(Number(picked.picked_qty), 150, 'picked_qty 应为两次之和')
    })

    // ── B1-S4 盒取任意正数（含散件模式的 1 个）──────────────────────────────
    await check('盒取 1 个（scanMode=散件）也应成功，不被当成非法扫描', async () => {
      const src = await makeWholeContainer(10)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(1)

      const r = await http.post('/api/scan-logs', {
        token,
        headers: pdaHeaders(),
        json: {
          taskId: sale.taskId, itemId: sale.itemId, containerId: box, barcode: boxBarcode,
          productId: Number(product.id), qty: 1, scanMode: '散件',
        },
      })
      assert.ok(r.ok, `散件模式取 1 个应成功：${JSON.stringify(r.data).slice(0, 200)}`)
      assert.equal(Number((await containerOf(box)).remaining_qty), 9, '盒应减 1')
    })

    // ── B1-S5 反向：数量超盒内实存 → 4xx 且零副作用 ──────────────────────────
    await check('盒取数量超过盒内实存：4xx（非 5xx）且零副作用', async () => {
      const src = await makeWholeContainer(10)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(100) // 需求 100 > 盒内 10：确保先过「未拣需求」，真正落到「超盒余量」校验
      const beforeBox = Number((await containerOf(box)).remaining_qty)
      const countNewI = async () =>
        Number((await dbQuery(pool,
          "SELECT COUNT(*) c FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=?",
          [box]))[0].c)
      const n0 = await countNewI()

      const r = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 15, key('over'))
      assert.ok(r.status >= 400 && r.status < 500, `超量应 4xx（500 不接受），实际 ${r.status}`)
      assert.equal(Number((await containerOf(box)).remaining_qty), beforeBox, '被拒后盒余量不得变化')
      assert.equal(await countNewI(), n0, '被拒后不得生成新 I')
    })

    // ── B1-S6 旧「扫整件 I」路径不回归 ───────────────────────────────────────
    await check('旧「扫整件 I」路径不回归：锁 I 本身、scan_logs 指 I、不生成新 I', async () => {
      const src = await makeWholeContainer(50)
      const srcBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [src]))[0].barcode
      const sale = await saleToTask(50)

      const r = await pickScan(sale.taskId, sale.itemId, src, srcBarcode, 50, key('legacy'))
      assert.ok(r.ok, `旧 I 扫码应成功：${JSON.stringify(r.data).slice(0, 200)}`)
      assert.equal(Number((await containerOf(src)).locked_by_task_id), sale.taskId, '旧路径应锁定 I 本身')
      const [sl] = await dbQuery(pool, 'SELECT container_id FROM scan_logs WHERE task_id=? ORDER BY id DESC LIMIT 1', [sale.taskId])
      assert.equal(Number(sl.container_id), Number(src), '旧路径 scan_logs.container_id 应指 I')
      const cnt = Number((await dbQuery(pool,
        "SELECT COUNT(*) c FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=?",
        [src]))[0].c)
      assert.equal(cnt, 0, '旧 I 路径不得生成取货新 I')
    })

    // ── B1-S7 范围校验覆盖重放（service 层直调，与 A 的范围重放用例同口径）────
    await check('范围校验覆盖重放：无该仓权限的同键重放必须被拒', async () => {
      const src = await makeWholeContainer(10)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(10)
      const svc = require('../backend/src/modules/scan-logs/scan-logs.service')
      const args = {
        taskId: sale.taskId, itemId: sale.itemId, containerId: box, barcode: boxBarcode,
        productId: Number(product.id), qty: 5, scanMode: '整件',
        operatorId: 1, operatorName: 'smoke_admin', scopeWarehouseIds: null,
      }
      const k = key('scope-replay')
      await svc.createScanLog({ ...args, requestKey: k })
      await assert.rejects(
        () => svc.createScanLog({ ...args, requestKey: k, scopeWarehouseIds: [999999] }),
        (e) => e.statusCode === 403 || /权限|范围/.test(String(e.message || '')),
        '重放路径未做仓库范围校验',
      )
    })

    // ── B1-S8 设备仓校验覆盖重放（票据有效 ≠ 目标仓匹配）──────────────────────
    await check('设备仓校验覆盖重放：PDA 设备仓 ≠ 任务仓的同键重放必须被拒', async () => {
      const src = await makeWholeContainer(10)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(10)
      const svc = require('../backend/src/modules/scan-logs/scan-logs.service')
      const args = {
        taskId: sale.taskId, itemId: sale.itemId, containerId: box, barcode: boxBarcode,
        productId: Number(product.id), qty: 5, scanMode: '整件',
        operatorId: 1, operatorName: 'smoke_admin', scopeWarehouseIds: null, pdaWarehouseId: null,
      }
      const k = key('pda-wh-replay')
      await svc.createScanLog({ ...args, requestKey: k })
      await assert.rejects(
        () => svc.createScanLog({ ...args, requestKey: k, pdaWarehouseId: 999999 }),
        (e) => e.statusCode === 403,
        '重放路径未做设备仓校验',
      )
    })

    // ── B2-S1 取货标签：jobType=pick_label、变量取自真实 PICK 行、同键不重复 ─────
    await check('扫盒取货入队取货标签：jobType=pick_label，变量含真实数量与销售单号，同键重放不重复', async () => {
      const src = await makeWholeContainer(100)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(60)
      const k = key('pick-label')

      const r = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 60, k)
      assert.ok(r.ok, `取货失败：${JSON.stringify(r.data).slice(0, 200)}`)
      const newI = Number(r.data.data.picked.container_id)
      const scanLogId = Number(r.data.data.id)
      assert.ok(r.data.data.picked.print, '回执应带打印状态（排队/缺设备/渲染失败）')

      // 打印任务：用途必须是 pick_label（**不得**用库存标签 type6 假充）
      const jobs = await dbQuery(pool,
        "SELECT id, job_type, status, content FROM print_jobs WHERE ref_id=? AND ref_type='inventory_container' ORDER BY id DESC",
        [newI])
      assert.ok(jobs.length >= 1, '应至少入队一条取货标签任务')
      assert.equal(jobs[0].job_type, 'pick_label', 'jobType 必须是 pick_label')
      const jobCount = async () =>
        Number((await dbQuery(pool,
          "SELECT COUNT(*) c FROM print_jobs WHERE ref_id=? AND job_type='pick_label'", [newI]))[0].c)
      const n1 = await jobCount()

      // 变量来源：**PICK 行**（数量=本次取货量），不是容器余量（发货后可能为 0）
      const { readLabelVariables } = require('../backend/src/modules/print-jobs/labelVariables')
      const source = await readLabelVariables(11, { id: scanLogId })
      assert.ok(source, '应能按 PICK 行读到取货标签变量')
      // DECIMAL 列返回 '60.00'——与既有容器标签（type 6 的 qty 同源）口径一致，按数值断言
      assert.equal(Number(source.vars.qty), 60, '取货数量应来自 PICK 行')
      assert.ok(String(source.vars.sale_order_no || '').length > 0, '应带销售单号')

      // 同键重放不重复入队
      const r2 = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 60, k)
      assert.ok(r2.ok, `重放应成功：${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.equal(await jobCount(), n1, '同键重放不得重复入队取货标签')
    })

    // ── B1-S9 取满：盒 200 分两次 100+100 取空 ────────────────────────────────
    await check('取满：盒 200 分两次各取 100 取空，两次分别生成新 I', async () => {
      const src = await makeWholeContainer(200)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(200)

      assert.ok((await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 100, key('f1'))).ok, '第一次取货失败')
      assert.ok((await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 100, key('f2'))).ok, '第二次取货失败')

      const row = await containerOf(box)
      assert.equal(Number(row.remaining_qty), 0, '盒应被取空')
      assert.equal(Number(row.status), 2, '取空后盒应为 EMPTY')
      const cnt = Number((await dbQuery(pool,
        "SELECT COUNT(*) c FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=?",
        [box]))[0].c)
      assert.equal(cnt, 2, '两次取货应各生成一个新 I')
    })

    // ── B1-S10 批次/日期继承：单批继承真实值；混合则全空 ──────────────────────
    await check('新取货码的批次/日期继承：单批继承真实 batch_no/exp_date，混合则全空', async () => {
      // 单批且带**真实到期日**（验证「空盒可合法承接带真实到期日的单批来源」）
      const dated = await makeWholeContainer(50, { batchNo: 'PBD1', expDate: '2027-06-30' })
      const box1 = await createEmptyBox()
      assert.equal((await fillReq(box1, dated, key('fill'))).status, 200, '前置：放货失败')
      const bb1 = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box1]))[0].barcode
      const sale1 = await saleToTask(50)
      assert.ok((await pickScan(sale1.taskId, sale1.itemId, box1, bb1, 50, key('p1'))).ok, '单批取货失败')
      const [ni1] = await dbQuery(pool,
        "SELECT batch_no, exp_date, is_mixed_batch FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1",
        [box1])
      assert.equal(ni1.batch_no, 'PBD1', '单批新码应继承真实批次号')
      assert.ok(ni1.exp_date != null, '单批新码应继承真实到期日')
      assert.equal(Number(ni1.is_mixed_batch), 0, '单批新码不应是混合')

      // 混合来源（两个不同批次、均无有效期）
      const m1 = await makeWholeContainer(10, { batchNo: 'PBM1' })
      const m2 = await makeWholeContainer(10, { batchNo: 'PBM2' })
      const mixBox = await createEmptyBox()
      assert.equal((await fillReq(mixBox, m1, key('fill'))).status, 200, '混合放货 1 失败')
      assert.equal((await fillReq(mixBox, m2, key('fill'))).status, 200, '混合放货 2 失败')
      const mb = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [mixBox]))[0].barcode
      const sale2 = await saleToTask(20)
      assert.ok((await pickScan(sale2.taskId, sale2.itemId, mixBox, mb, 20, key('p2'))).ok, '混合取货失败')
      const [ni2] = await dbQuery(pool,
        "SELECT batch_no, exp_date, is_mixed_batch FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1",
        [mixBox])
      assert.equal(Number(ni2.is_mixed_batch), 1, '混合来源新码应置混合')
      assert.equal(ni2.batch_no, null, '混合新码不得挂单一批次')
      assert.equal(ni2.exp_date, null, '混合新码无单批到期日')
    })

    // ── B2-S2 补打：真实走补打 API，用途仍 pick_label、容器/量/scan 数不变 ─────
    await check('补打取货码：走真实补打 API，用途仍 pick_label，且容器/量/scan 数不变', async () => {
      const src = await makeWholeContainer(50)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(30)
      const r = await pickScan(sale.taskId, sale.itemId, box, boxBarcode, 30, key('p1'))
      assert.ok(r.ok, `取货失败：${JSON.stringify(r.data).slice(0, 200)}`)
      const newI = Number(r.data.data.picked.container_id)

      const snapshot = async () => ({
        containers: Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_containers'))[0].c),
        scans: Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM scan_logs'))[0].c),
        qty: Number((await containerOf(newI)).remaining_qty),
        jobs: Number((await dbQuery(pool, "SELECT COUNT(*) c FROM print_jobs WHERE ref_id=? AND job_type='pick_label'", [newI]))[0].c),
      })
      const before = await snapshot()

      const rp = await http.post('/api/print-jobs/barcodes/reprint', {
        token, json: { category: 'inbound', recordId: newI },
      })
      assert.ok(rp.ok, `补打应成功：${JSON.stringify(rp.data).slice(0, 220)}`)

      const after = await snapshot()
      assert.equal(after.containers, before.containers, '补打不得新建容器')
      assert.equal(after.scans, before.scans, '补打不得新增 scan_logs')
      assert.equal(after.qty, before.qty, '补打不得改容器数量')
      assert.ok(after.jobs > before.jobs, '补打应新增一条打印任务')

      const [newest] = await dbQuery(pool, 'SELECT job_type FROM print_jobs WHERE ref_id=? ORDER BY id DESC LIMIT 1', [newI])
      assert.equal(newest.job_type, 'pick_label', '补打后用途仍须是 pick_label（不得落回库存标签）')
    })

    // ── B2-S3 降级类①：无可用打印机 —— 留 FAILED、业务保留 ───────────────────
    await check('取货标签降级（无可用打印机）：落 FAILED 记录、业务已提交、回执标明未打印', async () => {
      // 只需**临时停用设备**：resolveLabelPrinter 的候选走 `INNER JOIN ... status=1`，
      // 全部停用即保证无候选——**不必**动 printer_bindings（删了会丢 id/其它字段/原创建记录）。
      const printerSnapshot = await dbQuery(pool, 'SELECT id, status FROM printers')
      await dbQuery(pool, 'UPDATE printers SET status=0')
      try {
        const src = await makeWholeContainer(20)
        const box = await createEmptyBox()
        assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
        const bb = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
        const sale = await saleToTask(20)
        const r = await pickScan(sale.taskId, sale.itemId, box, bb, 20, key('np'))
        assert.ok(r.ok, '无可用打印机不得回滚取货')
        const newI = Number(r.data.data.picked.container_id)
        assert.equal(r.data.data.picked.print.queued, false, '回执应标明未排队')
        assert.equal(r.data.data.picked.print.unprintable, true, '回执应标明降级')
        assert.equal(Number((await containerOf(box)).remaining_qty), 0, '业务必须已提交（盒已取空）')
        const [job] = await dbQuery(pool,
          "SELECT status, printer_id, error_message FROM print_jobs WHERE ref_id=? AND job_type='pick_label' ORDER BY id DESC LIMIT 1",
          [newI])
        assert.ok(job, '应留下可补打的失败记录')
        assert.equal(Number(job.status), 3, '应为失败态 3')
        assert.equal(job.printer_id, null, '失败记录不带打印机')
        assert.ok(!/label render failed/.test(String(job.error_message || '')), '原因应是「无可用打印机」，不是渲染失败')
      } finally {
        // 逐原值恢复设备状态（binding 未动，无需恢复）
        for (const p of printerSnapshot) await dbQuery(pool, 'UPDATE printers SET status=? WHERE id=?', [p.status, p.id])
      }
    })

    // ── B2-S3 降级类②：真实渲染失败 —— 留 FAILED、原因写明、业务保留 ──────────
    await check('取货标签降级（渲染失败）：落 FAILED、原因写明渲染失败、业务已提交', async () => {
      const src = await makeWholeContainer(20)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const bb = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(20)
      globalThis.__PB_FORCE_RENDER_FAIL__ = true
      let r
      try {
        r = await pickScan(sale.taskId, sale.itemId, box, bb, 20, key('rf'))
      } finally {
        globalThis.__PB_FORCE_RENDER_FAIL__ = false
      }
      assert.ok(r.ok, '渲染失败不得回滚取货')
      const newI = Number(r.data.data.picked.container_id)
      assert.equal(r.data.data.picked.print.unprintable, true, '回执应标明降级')
      assert.equal(Number((await containerOf(box)).remaining_qty), 0, '业务必须已提交')
      const [job] = await dbQuery(pool,
        "SELECT status, error_message FROM print_jobs WHERE ref_id=? AND job_type='pick_label' ORDER BY id DESC LIMIT 1",
        [newI])
      assert.ok(job, '应留下可补打的失败记录')
      assert.equal(Number(job.status), 3, '应为失败态 3')
      assert.match(String(job.error_message || ''), /label render failed/, '原因须写明渲染失败')
    })

    // ── B1-S11 拒绝类①：超过任务未拣需求 ⇒ 4xx 且零副作用 ────────────────────
    await check('盒取超过任务未拣量：4xx（非 5xx）且零副作用（不生成新 I、盒不减）', async () => {
      const src = await makeWholeContainer(50)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const bb = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
      const sale = await saleToTask(10) // 任务只要 10
      const beforeBox = Number((await containerOf(box)).remaining_qty)
      const countNewI = async () =>
        Number((await dbQuery(pool,
          "SELECT COUNT(*) c FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=?",
          [box]))[0].c)
      const n0 = await countNewI()

      // 取 30 > 未拣 10，而盒内 50 足够 ⇒ 命中的正是「未拣需求」这道闸
      const r = await pickScan(sale.taskId, sale.itemId, box, bb, 30, key('over-need'))
      assert.ok(r.status >= 400 && r.status < 500, `应 4xx（500 不接受），实际 ${r.status}`)
      assert.equal(Number((await containerOf(box)).remaining_qty), beforeBox, '被拒后盒余量不得变化')
      assert.equal(await countNewI(), n0, '被拒后不得生成新 I')
    })

    // ── B1-S11 拒绝类②：盒绑商品 ≠ 任务商品 ⇒ 引擎层同样拒绝（直调，绕开 service 更早闸）──
    await check('盒绑商品与任务商品不符：引擎层独立拒绝（直调 extractFromPlasticBoxToTask）', async () => {
      const src = await makeWholeContainer(20)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
      const sale = await saleToTask(20)
      const engine = require('../backend/src/engine/containerEngine')
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        await assert.rejects(
          () => engine.extractFromPlasticBoxToTask(conn, {
            taskId: sale.taskId,
            boxContainerId: box,
            productId: 999999, // 与盒绑定商品不符
            warehouseId: Number(warehouse.id),
            qty: 1,
            operatorId: 1,
            operatorName: 'smoke_admin',
          }),
          (e) => /商品/.test(String(e.message || '')),
          '引擎层应独立拒绝「盒绑商品与任务商品不符」',
        )
      } finally {
        await conn.rollback()
        conn.release()
      }
    })

    // ── B2-S4 模板保存即生效（真实 POST）：is_default=1 且实际渲染使用新布局 ──────
    await check('新建 type=11 模板后自动成为该类型默认，且实际标签渲染使用新布局', async () => {
      // 先记录**既有** type 11 默认，收尾时恢复（不得把他人默认清零留空）
      const priorDefaults = await dbQuery(pool, 'SELECT id FROM print_templates WHERE type=11 AND is_default=1')
      const priorDefaultId = priorDefaults.length ? Number(priorDefaults[0].id) : null

      const zplBody = '^XA^FO50,50^A0N,30,30^FDREG-CHECK^FS^XZ'
      const created = await http.post('/api/print-templates', {
        token,
        json: {
          name: `PB取货模板-${Date.now().toString(36)}`,
          type: 11,
          layout: { format: 'zpl', body: zplBody },
        },
      })
      assert.ok(created.ok, `建模板失败：${JSON.stringify(created.data).slice(0, 220)}`)
      const tplId = Number(created.data.data.id)
      try {
        const rows = await dbQuery(pool, 'SELECT is_default, type FROM print_templates WHERE id=?', [tplId])
        assert.equal(Number(rows[0].type), 11, '模板类型应为 11')
        assert.equal(Number(rows[0].is_default), 1, '保存后应自动成为该类型默认（type 11 也要自动设默认）')

        // 「保存成功但实际打印没变」是本次要防的缺陷：直接验证**实际渲染**用的是新布局
        const tpl = require('../backend/src/modules/print-jobs/labelZplTemplate')
        const zpl = await tpl.getLabelZplFromDefaultTemplate(11, { container_code: 'I000001', qty: '5' })
        assert.ok(zpl && String(zpl).includes('REG-CHECK'), '实际渲染应使用刚保存的布局')
      } finally {
        // 清理本用例模板走**合法 DELETE API**（不物理删、不越权）
        const del = await http.delete(`/api/print-templates/${tplId}`, { token })
        if (!del.ok) { failed++; console.error(`[FAIL] 清理模板 ${tplId} 失败：${del.status} ${JSON.stringify(del.data).slice(0, 120)}`) }
        // 恢复**既有** type 11 默认（若有）：保存新模板会把它清零，必须还原，不能留空
        if (priorDefaultId) {
          const back = await http.post(`/api/print-templates/${priorDefaultId}/default`, { token })
          if (!back.ok) { failed++; console.error(`[FAIL] 恢复既有默认 ${priorDefaultId} 失败：${back.status}`) }
        }
      }
    })
  } finally {
    // 按**自建 ID** 逐笔合法取消 + 归还：**每个响应都检查**，任何失败计入 `failed`
    //（因此套件会自然 exit 1，不会伪报成功），同时继续处理其余 ID。
    let cleaned = 0
    for (const { saleId, taskId } of createdSales) {
      try {
        // 只到「销售单已建、任务尚未生成」就失败的情形：直接合法取消该销售单
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
        // **只读核对本笔**：任务必须已取消(8) 且该任务自身剩余锁定容器必须为 0
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
    try { await close() } catch (e) { failed++; console.error(`[FAIL] 关闭测试服务/连接池失败：${e.message}`) }
    try { await require('../backend/src/config/db').pool.end() } catch (e) { failed++; console.error(`[FAIL] 关闭全局连接池失败：${e.message}`) }
  }

  console.log(`\n${'='.repeat(50)}\n  ${passed} passed, ${failed} failed\n${'='.repeat(50)}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error('套件异常终止：', e); process.exitCode = 1 })
