#!/usr/bin/env node
/**
 * FlowCube 业务集成测试（当前真实主链路 v2）
 *
 * 覆盖现行主链路与库存一致性，替代已废弃的旧脚本（旧脚本基于
 * 采购单直接 receive、销售单直接 confirm，相关接口已下线）。
 *
 * 当前覆盖：
 *   1. 采购入库：采购单 → 确认 → 生成收货订单 → 提交 PDA → 收货 → 上架
 *      （收货/上架走 PDA 会话；上架时 syncStockFromContainers 同步库存缓存）
 *   2. 库存预占：销售单 → 占用库存(reserve) → 释放(release)，校验 reserved 与 stock_reservations
 *   3. 调拨：创建 → 确认 → 执行，校验源/目标仓库库存与目标容器
 *   4. 盘点（盘盈）：创建 → 填实盘 → 提交，校验库存与盘盈容器
 *   5. 采购退货 / 销售退货：创建 → 确认 → 执行，校验库存出/入
 *   6. 混合采购单收货订单：一张收货单合并 2 个采购单的明细 → PDA 收货/上架 → 审核，
 *      校验每个采购单各自的应付结算金额与自动完成状态（回归测试，防止混单场景下
 *      settlePurchaseOnAudit 只认收货单头 purchase_order_id 导致漏结算的问题复发）
 *   7. 取消采购单联动收货单：混单场景未收货可取消（仅移出该采购单明细）、已收货则拒绝取消、
 *      单采购单场景未收货仍按原逻辑级联整单取消（回归测试，防止 purchase.cancel 只认收货单头
 *      purchase_order_id 导致混单场景下取消完全绕过收货流程保护的问题复发）
 *   8. 全局一致性不变量：inventory_stock = SUM(容器 remaining)，无负库存，reserved ≤ quantity
 *
 * 说明：销售完整出库链（拣货→分拣→复核→打包→出库，均为 PDA 多步扫码 +
 *   闭合校验）由 tests/concurrency-guards.smoke.test.js 在仓库任务层面把关，
 *   不在本确定性集成测试内重复编排，以保持可重复、可门禁。
 *
 * 运行方式：
 *   node tests/integration.test.js
 * 依赖与 smoke 测试相同（见 tests/helpers/smokeTestKit.js）：真实 MySQL，
 *   环境变量 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME、JWT_SECRET 等。
 */

'use strict'

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  createPurchaseOrder,
  confirmPurchaseOrder,
  createInboundTaskFromPurchase,
  randomRef,
} = require('./helpers/smokeTestKit')

const INBOUND_QTY = 50
const RESERVE_QTY = 20
const TRANSFER_QTY = 10
const CHECK_SURPLUS_QTY = 3
const PR_QTY = 5
const SR_QTY = 4

async function expectOk(log, response, label) {
  log.assert(
    label,
    response.ok && response.data && response.data.success === true,
    `status=${response.status} body=${JSON.stringify(response.data).slice(0, 300)}`,
  )
}

async function stockQty(pool, productId, warehouseId) {
  const rows = await dbQuery(
    pool,
    'SELECT COALESCE(quantity,0) AS quantity, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [productId, warehouseId],
  )
  return rows.length ? { quantity: Number(rows[0].quantity), reserved: Number(rows[0].reserved) } : { quantity: 0, reserved: 0 }
}

async function containerSum(pool, productId, warehouseId) {
  const rows = await dbQuery(
    pool,
    'SELECT COALESCE(SUM(remaining_qty),0) AS total FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL',
    [productId, warehouseId],
  )
  return Number(rows[0].total)
}

/** 通过 PDA 主链路把库存灌进 wh：采购 → 收货订单 → 收货 → 上架 */
async function inboundStock(log, ctx, token, { product, warehouse, location, quantity }) {
  const purchaseCreate = await createPurchaseOrder(ctx.http, token, { supplier: ctx.supplier, warehouse, product, quantity })
  await expectOk(log, purchaseCreate, '创建采购单成功')
  const purchaseId = Number(purchaseCreate.data?.data?.id)

  await expectOk(log, await confirmPurchaseOrder(ctx.http, token, purchaseId), '确认采购单成功')

  const inboundCreate = await createInboundTaskFromPurchase(ctx.http, token, purchaseId)
  await expectOk(log, inboundCreate, '由采购单生成收货订单成功')
  const taskId = Number(inboundCreate.data?.data?.taskId)

  await expectOk(log, await ctx.http.post(`/api/inbound-tasks/${taskId}/submit`, { token }), '收货订单提交到 PDA 成功')

  const receive = await ctx.http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token,
    headers: ctx.pdaHeaders(),
    json: { productId: Number(product.id), packages: [{ qty: quantity }] },
  })
  await expectOk(log, receive, 'PDA 收货成功')

  const containers = await ctx.http.get(`/api/inbound-tasks/${taskId}/containers`, { token })
  const pending = containers.data?.data?.waiting?.[0] || containers.data?.data?.list?.[0]
  log.assert('收货后存在待上架容器', !!pending, JSON.stringify(containers.data).slice(0, 300))

  const putaway = await ctx.http.post(`/api/inbound-tasks/${taskId}/putaway`, {
    token,
    headers: ctx.pdaHeaders(),
    json: { containerId: Number(pending.id), locationId: Number(location.id) },
  })
  await expectOk(log, putaway, 'PDA 上架成功（同步库存缓存）')
  return { purchaseId, taskId }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, location, supplier, customer } = ctx

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    log.assert('smoke_admin 登录成功', !!token, `status=${adminLogin.response.status}`)

    // 独立测试商品，确保起始库存为 0，不受 smoke 测试共享商品的累积影响
    const productCode = `INTEG-${randomRef('P')}`
    const [pr] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '集成测试商品', '个', 12)",
      [productCode],
    )
    const product = { id: pr.insertId, code: productCode, name: '集成测试商品', unit: '个' }

    // 调拨目标仓库（独立）
    const wh2Code = `INTEG-WH-${randomRef('W')}`
    const [wr] = await pool.query('INSERT INTO inventory_warehouses (code, name) VALUES (?, ?)', [wh2Code, '集成测试目标仓'])
    const wh2 = { id: wr.insertId, name: '集成测试目标仓' }

    // ── 1. 采购入库 ───────────────────────────────────────────────
    log.section('采购入库（PDA 收货 + 上架）')
    await inboundStock(log, ctx, token, { product, warehouse, location, quantity: INBOUND_QTY })
    let s = await stockQty(pool, product.id, warehouse.id)
    log.assert(`入库后 inventory_stock.quantity = ${INBOUND_QTY}`, s.quantity === INBOUND_QTY, `实际=${s.quantity}`)
    log.assert('入库后 reserved = 0', s.reserved === 0, `实际=${s.reserved}`)
    log.assert('入库后 容器总量 = 库存缓存', (await containerSum(pool, product.id, warehouse.id)) === s.quantity)

    // ── 2. 库存预占 / 释放 ───────────────────────────────────────
    log.section('销售占库 / 释放（reserve / release）')
    const saleCreate = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('integ-sale'),
        items: [{ productId: Number(product.id), productCode: product.code, productName: product.name, unit: product.unit, quantity: RESERVE_QTY, unitPrice: 15 }],
      },
    })
    await expectOk(log, saleCreate, '创建销售单成功')
    const saleId = Number(saleCreate.data?.data?.id)

    await expectOk(log, await http.post(`/api/sale/${saleId}/reserve`, { token }), '销售单占库成功')
    s = await stockQty(pool, product.id, warehouse.id)
    log.assert(`占库后 reserved = ${RESERVE_QTY}`, s.reserved === RESERVE_QTY, `实际=${s.reserved}`)
    log.assert('占库不改变物理库存 quantity', s.quantity === INBOUND_QTY, `实际=${s.quantity}`)
    const resv = await dbQuery(pool, "SELECT qty, status FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND product_id=?", [saleId, product.id])
    log.assert('stock_reservations 生成预占记录（status=1, qty对得上）', resv.length === 1 && Number(resv[0].qty) === RESERVE_QTY && Number(resv[0].status) === 1, JSON.stringify(resv))

    await expectOk(log, await http.post(`/api/sale/${saleId}/release`, { token }), '销售单释放占库成功')
    s = await stockQty(pool, product.id, warehouse.id)
    log.assert('释放后 reserved = 0', s.reserved === 0, `实际=${s.reserved}`)
    const resvAfter = await dbQuery(pool, "SELECT status FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND product_id=?", [saleId, product.id])
    log.assert('释放后预占记录状态=3（已释放）', resvAfter.every(r => Number(r.status) === 3), JSON.stringify(resvAfter))

    // ── 3. 调拨（两阶段：确认派发 PDA → 源仓扫码出库 → 目标仓扫码入库上架）──
    log.section('调拨（wh1 → wh2，PDA 两阶段扫码）')
    const wh1Before = (await stockQty(pool, product.id, warehouse.id)).quantity
    const wh2Before = (await stockQty(pool, product.id, wh2.id)).quantity

    // 从入库容器中拆出一个 TRANSFER_QTY 大小的独立容器，用于整箱扫码调拨（scanOut 按整容器移动）
    const [srcContainerRow] = await dbQuery(
      pool,
      "SELECT id FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL ORDER BY id LIMIT 1",
      [product.id, warehouse.id],
    )
    log.assert('调拨前存在可用源容器', !!srcContainerRow, JSON.stringify(srcContainerRow))
    const splitResp = await http.post(`/api/inventory/containers/${srcContainerRow.id}/split`, {
      token, json: { qty: TRANSFER_QTY },
    })
    await expectOk(log, splitResp, '拆分出调拨用容器成功')
    const transferContainerBarcode = splitResp.data?.data?.newBarcode

    // 目标仓需要一个可用库位供 PDA 扫码入库上架
    const [wh2LocResult] = await pool.query(
      'INSERT INTO warehouse_locations (warehouse_id, code, name) VALUES (?, ?, ?)',
      [Number(wh2.id), `INTEG-LOC-${randomRef('L')}`, '集成测试目标库位'],
    )
    const wh2LocationId = wh2LocResult.insertId

    const transferCreate = await http.post('/api/transfer', {
      token,
      json: {
        fromWarehouseId: Number(warehouse.id), fromWarehouseName: warehouse.name,
        toWarehouseId: Number(wh2.id), toWarehouseName: wh2.name,
        remark: randomRef('integ-transfer'),
        items: [{ productId: Number(product.id), productCode: product.code, productName: product.name, unit: product.unit, quantity: TRANSFER_QTY }],
      },
    })
    log.assert('创建调拨单成功(201)', transferCreate.status === 201 && !!transferCreate.data?.data?.id, `status=${transferCreate.status}`)
    const transferId = Number(transferCreate.data?.data?.id)
    await expectOk(log, await http.post(`/api/transfer/${transferId}/confirm`, { token }), '确认调拨单成功（派发到 PDA）')
    await expectOk(
      log,
      await http.post(`/api/transfer/${transferId}/scan-out`, { token, headers: ctx.pdaHeaders(), json: { containerBarcode: transferContainerBarcode } }),
      '源仓 PDA 扫码出库成功',
    )
    await expectOk(
      log,
      await http.post(`/api/transfer/${transferId}/scan-in`, { token, headers: ctx.pdaHeaders(), json: { containerBarcode: transferContainerBarcode, locationId: wh2LocationId } }),
      '目标仓 PDA 扫码入库成功（调拨完成）',
    )

    log.assert(`调拨后源仓 quantity = ${wh1Before - TRANSFER_QTY}`, (await stockQty(pool, product.id, warehouse.id)).quantity === wh1Before - TRANSFER_QTY)
    log.assert(`调拨后目标仓 quantity = ${wh2Before + TRANSFER_QTY}`, (await stockQty(pool, product.id, wh2.id)).quantity === wh2Before + TRANSFER_QTY)
    log.assert('调拨后目标仓生成容器', (await containerSum(pool, product.id, wh2.id)) === wh2Before + TRANSFER_QTY)

    // ── 4. 盘点（盘盈） ──────────────────────────────────────────
    log.section('盘点（盘盈 +N）')
    const qtyBeforeCheck = (await stockQty(pool, product.id, warehouse.id)).quantity
    const checkCreate = await http.post('/api/stockcheck', {
      token,
      json: { warehouseId: Number(warehouse.id), warehouseName: warehouse.name, remark: randomRef('integ-check') },
    })
    log.assert('创建盘点单成功(201)', checkCreate.status === 201 && !!checkCreate.data?.data?.id, `status=${checkCreate.status}`)
    const checkId = Number(checkCreate.data?.data?.id)
    const checkDetail = await http.get(`/api/stockcheck/${checkId}`, { token })
    const checkItems = checkDetail.data?.data?.items || []
    const targetItem = checkItems.find(i => Number(i.productId) === Number(product.id))
    log.assert('盘点单含目标商品', !!targetItem, JSON.stringify(checkItems).slice(0, 300))
    if (targetItem) {
      // submit 要求所有明细都已填写实盘数；共享仓库内的其它商品按账面填写（差异为 0，不调整）
      const payload = checkItems.map(i => ({
        id: Number(i.id),
        actualQty: Number(i.productId) === Number(product.id)
          ? Number(i.bookQty) + CHECK_SURPLUS_QTY
          : Number(i.bookQty),
      }))
      await expectOk(log, await http.put(`/api/stockcheck/${checkId}/items`, { token, json: { items: payload } }), '填写实盘数量成功')
      await expectOk(log, await http.post(`/api/stockcheck/${checkId}/submit`, { token }), '盘点提交成功')
    }
    log.assert(`盘点后 quantity = ${qtyBeforeCheck + CHECK_SURPLUS_QTY}`, (await stockQty(pool, product.id, warehouse.id)).quantity === qtyBeforeCheck + CHECK_SURPLUS_QTY)
    const checkContainer = await dbQuery(pool, "SELECT remaining_qty FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND source_ref_type='stockcheck' ORDER BY id DESC LIMIT 1", [product.id, warehouse.id])
    log.assert(`盘盈生成新容器 remaining=${CHECK_SURPLUS_QTY}`, checkContainer.length > 0 && Number(checkContainer[0].remaining_qty) === CHECK_SURPLUS_QTY, JSON.stringify(checkContainer))

    // ── 5. 采购退货（确认后派发 PDA 仓库任务 → 拣货扫码 → 出库）──
    log.section('采购退货（PDA 拣货→出库，库存扣减）')
    const qtyBeforePR = (await stockQty(pool, product.id, warehouse.id)).quantity
    const [prSrcContainer] = await dbQuery(
      pool,
      "SELECT id FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL ORDER BY id LIMIT 1",
      [product.id, warehouse.id],
    )
    log.assert('采购退货前存在可用源容器', !!prSrcContainer, JSON.stringify(prSrcContainer))
    const prSplitResp = await http.post(`/api/inventory/containers/${prSrcContainer.id}/split`, { token, json: { qty: PR_QTY } })
    await expectOk(log, prSplitResp, '拆分出采购退货用容器成功')
    const prContainerId = prSplitResp.data?.data?.newContainerId
    const prContainerBarcode = prSplitResp.data?.data?.newBarcode

    const prCreate = await http.post('/api/returns/purchase', {
      token,
      json: {
        supplierId: Number(supplier.id), supplierName: supplier.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('integ-pr'),
        items: [{ productId: Number(product.id), productCode: product.code, productName: product.name, unit: product.unit, quantity: PR_QTY, unitPrice: 10 }],
      },
    })
    log.assert('创建采购退货单成功(201)', prCreate.status === 201 && !!prCreate.data?.data?.id, `status=${prCreate.status}`)
    const prId = Number(prCreate.data?.data?.id)
    await expectOk(log, await http.post(`/api/returns/purchase/${prId}/confirm`, { token }), '确认采购退货单成功（自动派发 PDA）')

    const [prTaskRow] = await dbQuery(pool, "SELECT id FROM warehouse_tasks WHERE return_id=? AND task_type='purchase_return' ORDER BY id DESC LIMIT 1", [prId])
    log.assert('已自动创建采购退货仓库任务', !!prTaskRow, JSON.stringify(prTaskRow))
    const prTaskId = prTaskRow.id
    const [prTaskItem] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=? AND product_id=?', [prTaskId, product.id])

    const prScanResp = await http.post('/api/scan-logs', {
      token, headers: ctx.pdaHeaders(),
      json: { taskId: prTaskId, itemId: prTaskItem.id, containerId: prContainerId, barcode: prContainerBarcode, productId: Number(product.id), qty: PR_QTY, scanMode: '整件' },
    })
    await expectOk(log, prScanResp, 'PDA 拣货扫码成功')
    await expectOk(log, await http.put(`/api/warehouse-tasks/${prTaskId}/ready`, { token, headers: ctx.pdaHeaders() }), '拣货收口成功（采购退货直接跳至待出库）')
    await expectOk(log, await http.put(`/api/warehouse-tasks/${prTaskId}/ship`, { token, headers: ctx.pdaHeaders() }), 'PDA 出库成功')
    log.assert(`采购退货后 quantity = ${qtyBeforePR - PR_QTY}`, (await stockQty(pool, product.id, warehouse.id)).quantity === qtyBeforePR - PR_QTY)

    // ── 6. 销售退货（确认后派发 PDA 退货任务 → 收货→质检→上架）──
    log.section('销售退货（PDA 收货→质检→上架，库存入库）')
    const qtyBeforeSR = (await stockQty(pool, product.id, warehouse.id)).quantity
    const srCreate = await http.post('/api/returns/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('integ-sr'),
        items: [{ productId: Number(product.id), productCode: product.code, productName: product.name, unit: product.unit, quantity: SR_QTY, unitPrice: 15 }],
      },
    })
    log.assert('创建销售退货单成功(201)', srCreate.status === 201 && !!srCreate.data?.data?.id, `status=${srCreate.status}`)
    const srId = Number(srCreate.data?.data?.id)
    await expectOk(log, await http.post(`/api/returns/sale/${srId}/confirm`, { token }), '确认销售退货单成功（自动派发 PDA）')

    const [srTaskRow] = await dbQuery(pool, "SELECT id, submitted_at FROM return_tasks WHERE return_id=? AND return_type='sale' ORDER BY id DESC LIMIT 1", [srId])
    log.assert('已自动创建销售退货任务且已派发到 PDA', !!srTaskRow && !!srTaskRow.submitted_at, JSON.stringify(srTaskRow))
    const srTaskId = srTaskRow.id

    const srReceiveResp = await http.post(`/api/return-tasks/${srTaskId}/receive`, {
      token, headers: ctx.pdaHeaders(),
      json: { productId: Number(product.id), packages: [{ qty: SR_QTY }] },
    })
    await expectOk(log, srReceiveResp, 'PDA 收货成功')
    const srContainerId = srReceiveResp.data?.data?.containers?.[0]?.containerId

    await expectOk(log, await http.post(`/api/return-tasks/${srTaskId}/check`, {
      token, headers: ctx.pdaHeaders(),
      json: { productId: Number(product.id), passedQty: SR_QTY },
    }), 'PDA 质检成功')

    await expectOk(log, await http.post(`/api/return-tasks/${srTaskId}/putaway`, {
      token, headers: ctx.pdaHeaders(),
      json: { containerId: srContainerId, locationId: Number(location.id) },
    }), 'PDA 上架成功')

    log.assert(`销售退货后 quantity = ${qtyBeforeSR + SR_QTY}`, (await stockQty(pool, product.id, warehouse.id)).quantity === qtyBeforeSR + SR_QTY)
    const srContainer = await dbQuery(pool, "SELECT remaining_qty FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND source_ref_type='sale_return' ORDER BY id DESC LIMIT 1", [product.id, warehouse.id])
    log.assert(`销售退货生成新容器 remaining=${SR_QTY}`, srContainer.length > 0 && Number(srContainer[0].remaining_qty) === SR_QTY, JSON.stringify(srContainer))

    // ── 6. 混合采购单收货订单结算（回归：settlePurchaseOnAudit 混单场景）──
    log.section('混合采购单收货订单（合并 2 个采购单 → 审核结算）')
    const MIX_QTY_A = 6, MIX_PRICE_A = 50
    const MIX_QTY_B = 4, MIX_PRICE_B = 20

    const [mpA] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '混合测试商品A', '个', 12)",
      [`INTEG-MIXA-${randomRef('P')}`],
    )
    const [mpB] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '混合测试商品B', '个', 12)",
      [`INTEG-MIXB-${randomRef('P')}`],
    )
    const mixProductA = { id: mpA.insertId, code: `INTEG-MIXA-${mpA.insertId}`, name: '混合测试商品A', unit: '个' }
    const mixProductB = { id: mpB.insertId, code: `INTEG-MIXB-${mpB.insertId}`, name: '混合测试商品B', unit: '个' }

    const poACreate = await http.post('/api/purchase', {
      token,
      json: {
        supplierId: Number(supplier.id), supplierName: supplier.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        items: [{ productId: mixProductA.id, productCode: mixProductA.code, productName: mixProductA.name, unit: mixProductA.unit, quantity: MIX_QTY_A, unitPrice: MIX_PRICE_A }],
      },
    })
    await expectOk(log, poACreate, '创建采购单A成功')
    const poAId = Number(poACreate.data?.data?.id)
    await expectOk(log, await http.post(`/api/purchase/${poAId}/confirm`, { token }), '确认采购单A成功')

    const poBCreate = await http.post('/api/purchase', {
      token,
      json: {
        supplierId: Number(supplier.id), supplierName: supplier.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        items: [{ productId: mixProductB.id, productCode: mixProductB.code, productName: mixProductB.name, unit: mixProductB.unit, quantity: MIX_QTY_B, unitPrice: MIX_PRICE_B }],
      },
    })
    await expectOk(log, poBCreate, '创建采购单B成功')
    const poBId = Number(poBCreate.data?.data?.id)
    await expectOk(log, await http.post(`/api/purchase/${poBId}/confirm`, { token }), '确认采购单B成功')

    const poItemARows = await dbQuery(pool, 'SELECT id FROM purchase_order_items WHERE order_id=?', [poAId])
    const poItemBRows = await dbQuery(pool, 'SELECT id FROM purchase_order_items WHERE order_id=?', [poBId])
    const poItemAId = poItemARows[0].id
    const poItemBId = poItemBRows[0].id

    const mixTaskCreate = await http.post('/api/inbound-tasks', {
      token,
      json: {
        supplierId: Number(supplier.id),
        supplierName: supplier.name,
        remark: randomRef('integ-mix'),
        items: [
          { purchaseItemId: poItemAId, qty: MIX_QTY_A },
          { purchaseItemId: poItemBId, qty: MIX_QTY_B },
        ],
      },
    })
    await expectOk(log, mixTaskCreate, '创建混合采购单收货订单成功')
    const mixTaskId = Number(mixTaskCreate.data?.data?.taskId)

    const mixTaskRows = await dbQuery(pool, 'SELECT purchase_order_id FROM inbound_tasks WHERE id=?', [mixTaskId])
    log.assert('混合收货单头 purchase_order_id 为空（混单标志）', mixTaskRows[0].purchase_order_id === null, JSON.stringify(mixTaskRows[0]))

    await expectOk(log, await http.post(`/api/inbound-tasks/${mixTaskId}/submit`, { token }), '混合收货单提交到 PDA 成功')

    await expectOk(log, await http.post(`/api/inbound-tasks/${mixTaskId}/receive`, {
      token, headers: ctx.pdaHeaders(),
      json: { productId: mixProductA.id, packages: [{ qty: MIX_QTY_A }] },
    }), 'PDA 收货商品A成功')
    await expectOk(log, await http.post(`/api/inbound-tasks/${mixTaskId}/receive`, {
      token, headers: ctx.pdaHeaders(),
      json: { productId: mixProductB.id, packages: [{ qty: MIX_QTY_B }] },
    }), 'PDA 收货商品B成功')

    const mixContainersResp = await http.get(`/api/inbound-tasks/${mixTaskId}/containers`, { token })
    const waitingList = mixContainersResp.data?.data?.waiting || []
    const containerA = waitingList.find(c => Number(c.productId) === Number(mixProductA.id))
    const containerB = waitingList.find(c => Number(c.productId) === Number(mixProductB.id))
    log.assert('收货后存在商品A待上架容器', !!containerA, JSON.stringify(waitingList).slice(0, 300))
    log.assert('收货后存在商品B待上架容器', !!containerB, JSON.stringify(waitingList).slice(0, 300))

    await expectOk(log, await http.post(`/api/inbound-tasks/${mixTaskId}/putaway`, {
      token, headers: ctx.pdaHeaders(),
      json: { containerId: Number(containerA.id), locationId: Number(location.id) },
    }), 'PDA 上架商品A成功')
    await expectOk(log, await http.post(`/api/inbound-tasks/${mixTaskId}/putaway`, {
      token, headers: ctx.pdaHeaders(),
      json: { containerId: Number(containerB.id), locationId: Number(location.id) },
    }), 'PDA 上架商品B成功')

    // 混合收货单第二个商品上架完成后，系统自动结算（不再需要人工审核）
    const mixPayments = await dbQuery(
      pool,
      'SELECT order_id, total_amount FROM payment_records WHERE type=1 AND order_id IN (?, ?) ORDER BY order_id',
      [poAId, poBId],
    )
    log.assert(
      `混单结算生成正确应付：A=${MIX_QTY_A * MIX_PRICE_A}, B=${MIX_QTY_B * MIX_PRICE_B}`,
      mixPayments.length === 2 &&
        Number(mixPayments.find(p => p.order_id === poAId)?.total_amount) === MIX_QTY_A * MIX_PRICE_A &&
        Number(mixPayments.find(p => p.order_id === poBId)?.total_amount) === MIX_QTY_B * MIX_PRICE_B,
      JSON.stringify(mixPayments),
    )

    const mixPos = await dbQuery(pool, 'SELECT id, status FROM purchase_orders WHERE id IN (?, ?)', [poAId, poBId])
    log.assert('混单结算后两张采购单均自动完成(status=3)', mixPos.length === 2 && mixPos.every(p => Number(p.status) === 3), JSON.stringify(mixPos))

    // ── 7. 取消采购单联动收货单（回归：purchase.cancel 混单场景 + 已收货保护）──
    log.section('取消采购单联动收货单（混单移出 / 已收货阻止 / 单采购单级联）')

    // 7a. 混单场景：采购单被合并进收货单但尚未收货 → 取消应成功，仅移出该采购单的明细，收货单继续处理另一采购单
    const [pc] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '取消测试商品C', '个', 12)",
      [`INTEG-CANC-${randomRef('P')}`],
    )
    const [pd] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '取消测试商品D', '个', 12)",
      [`INTEG-CAND-${randomRef('P')}`],
    )
    const productC = { id: pc.insertId, code: `INTEG-CANC-${pc.insertId}`, name: '取消测试商品C', unit: '个' }
    const productD = { id: pd.insertId, code: `INTEG-CAND-${pd.insertId}`, name: '取消测试商品D', unit: '个' }
    const CANC_QTY_C = 3, CANC_QTY_D = 5

    const poCCreate = await http.post('/api/purchase', {
      token,
      json: {
        supplierId: Number(supplier.id), supplierName: supplier.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        items: [{ productId: productC.id, productCode: productC.code, productName: productC.name, unit: productC.unit, quantity: CANC_QTY_C, unitPrice: 10 }],
      },
    })
    await expectOk(log, poCCreate, '创建采购单C成功')
    const poCId = Number(poCCreate.data?.data?.id)
    await expectOk(log, await http.post(`/api/purchase/${poCId}/confirm`, { token }), '确认采购单C成功')

    const poDCreate = await http.post('/api/purchase', {
      token,
      json: {
        supplierId: Number(supplier.id), supplierName: supplier.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        items: [{ productId: productD.id, productCode: productD.code, productName: productD.name, unit: productD.unit, quantity: CANC_QTY_D, unitPrice: 10 }],
      },
    })
    await expectOk(log, poDCreate, '创建采购单D成功')
    const poDId = Number(poDCreate.data?.data?.id)
    await expectOk(log, await http.post(`/api/purchase/${poDId}/confirm`, { token }), '确认采购单D成功')

    const poItemCId = (await dbQuery(pool, 'SELECT id FROM purchase_order_items WHERE order_id=?', [poCId]))[0].id
    const poItemDId = (await dbQuery(pool, 'SELECT id FROM purchase_order_items WHERE order_id=?', [poDId]))[0].id

    const mixCdTaskCreate = await http.post('/api/inbound-tasks', {
      token,
      json: {
        supplierId: Number(supplier.id),
        supplierName: supplier.name,
        remark: randomRef('integ-cancel-mix'),
        items: [
          { purchaseItemId: poItemCId, qty: CANC_QTY_C },
          { purchaseItemId: poItemDId, qty: CANC_QTY_D },
        ],
      },
    })
    await expectOk(log, mixCdTaskCreate, '创建混合收货单（C+D）成功')
    const mixCdTaskId = Number(mixCdTaskCreate.data?.data?.taskId)

    const cancelPoC = await http.post(`/api/purchase/${poCId}/cancel`, { token })
    await expectOk(log, cancelPoC, '未收货的混单采购单C取消成功（应移出明细而非整单拒绝）')

    const poCAfter = await dbQuery(pool, 'SELECT status FROM purchase_orders WHERE id=?', [poCId])
    log.assert('采购单C已取消(status=4)', poCAfter[0]?.status === 4, JSON.stringify(poCAfter))

    const remainItemsAfterCancel = await dbQuery(
      pool,
      'SELECT purchase_order_id FROM inbound_task_items WHERE task_id=?',
      [mixCdTaskId],
    )
    log.assert(
      '混合收货单已移出采购单C的明细，仅保留采购单D',
      remainItemsAfterCancel.length === 1 && Number(remainItemsAfterCancel[0].purchase_order_id) === poDId,
      JSON.stringify(remainItemsAfterCancel),
    )

    const mixCdTaskAfter = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [mixCdTaskId])
    log.assert('混合收货单未被级联取消，继续处理采购单D(status<>5)', Number(mixCdTaskAfter[0]?.status) !== 5, JSON.stringify(mixCdTaskAfter))

    // 7b. 已实际收货的采购单 → 取消应被拒绝（保护已产生的容器/标签）
    const [pe] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '取消测试商品E', '个', 12)",
      [`INTEG-CANE-${randomRef('P')}`],
    )
    const productE = { id: pe.insertId, code: `INTEG-CANE-${pe.insertId}`, name: '取消测试商品E', unit: '个' }
    const CANC_QTY_E = 2

    const poECreate = await createPurchaseOrder(http, token, { supplier, warehouse, product: productE, quantity: CANC_QTY_E })
    await expectOk(log, poECreate, '创建采购单E成功')
    const poEId = Number(poECreate.data?.data?.id)
    await expectOk(log, await confirmPurchaseOrder(http, token, poEId), '确认采购单E成功')

    const inboundECreate = await createInboundTaskFromPurchase(http, token, poEId)
    await expectOk(log, inboundECreate, '由采购单E生成收货订单成功')
    const taskEId = Number(inboundECreate.data?.data?.taskId)
    await expectOk(log, await http.post(`/api/inbound-tasks/${taskEId}/submit`, { token }), '收货订单E提交到 PDA 成功')
    await expectOk(log, await http.post(`/api/inbound-tasks/${taskEId}/receive`, {
      token, headers: ctx.pdaHeaders(),
      json: { productId: Number(productE.id), packages: [{ qty: CANC_QTY_E }] },
    }), 'PDA 收货商品E成功')

    const cancelPoE = await http.post(`/api/purchase/${poEId}/cancel`, { token })
    log.assert('已收货的采购单E取消被拒绝(409)', !cancelPoE.ok && cancelPoE.status === 409, `status=${cancelPoE.status} body=${JSON.stringify(cancelPoE.data).slice(0, 300)}`)

    const poEAfter = await dbQuery(pool, 'SELECT status FROM purchase_orders WHERE id=?', [poEId])
    log.assert('采购单E仍为已提交(status=2)，未被误取消', poEAfter[0]?.status === 2, JSON.stringify(poEAfter))

    // 7c. 单采购单场景（非混单）+ 尚未收货 → 保持原有级联整单取消行为不变
    const [pf] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '取消测试商品F', '个', 12)",
      [`INTEG-CANF-${randomRef('P')}`],
    )
    const productF = { id: pf.insertId, code: `INTEG-CANF-${pf.insertId}`, name: '取消测试商品F', unit: '个' }

    const poFCreate = await createPurchaseOrder(http, token, { supplier, warehouse, product: productF, quantity: 1 })
    await expectOk(log, poFCreate, '创建采购单F成功')
    const poFId = Number(poFCreate.data?.data?.id)
    await expectOk(log, await confirmPurchaseOrder(http, token, poFId), '确认采购单F成功')

    const inboundFCreate = await createInboundTaskFromPurchase(http, token, poFId)
    await expectOk(log, inboundFCreate, '由采购单F生成收货订单成功')
    const taskFId = Number(inboundFCreate.data?.data?.taskId)

    const cancelPoF = await http.post(`/api/purchase/${poFId}/cancel`, { token })
    await expectOk(log, cancelPoF, '未收货的单采购单F取消成功（级联整单取消收货单）')

    const poFAfter = await dbQuery(pool, 'SELECT status FROM purchase_orders WHERE id=?', [poFId])
    log.assert('采购单F已取消(status=4)', poFAfter[0]?.status === 4, JSON.stringify(poFAfter))
    const taskFAfter = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [taskFId])
    log.assert('单采购单收货单被级联取消(status=5)', Number(taskFAfter[0]?.status) === 5, JSON.stringify(taskFAfter))

    // ── 8. 全局一致性不变量 ──────────────────────────────────────
    log.section('全局一致性不变量')
    const inconsistencies = await dbQuery(pool, `
      SELECT s.product_id, s.warehouse_id, s.quantity AS cached_qty, COALESCE(SUM(c.remaining_qty),0) AS container_sum
      FROM inventory_stock s
      LEFT JOIN inventory_containers c
        ON c.product_id=s.product_id AND c.warehouse_id=s.warehouse_id AND c.status=1 AND c.deleted_at IS NULL
      GROUP BY s.product_id, s.warehouse_id
      HAVING ABS(cached_qty - container_sum) > 0.0001`)
    log.assert('inventory_stock 与容器总量完全一致', inconsistencies.length === 0, `不一致行数=${inconsistencies.length}: ${JSON.stringify(inconsistencies).slice(0, 300)}`)

    const negativeStock = await dbQuery(pool, 'SELECT COUNT(*) AS cnt FROM inventory_stock WHERE quantity < 0')
    log.assert('无负库存（quantity >= 0）', Number(negativeStock[0].cnt) === 0)

    const overReserved = await dbQuery(pool, 'SELECT COUNT(*) AS cnt FROM inventory_stock WHERE reserved > quantity')
    log.assert('无 reserved > quantity', Number(overReserved[0].cnt) === 0)

    const negativeContainer = await dbQuery(pool, 'SELECT COUNT(*) AS cnt FROM inventory_containers WHERE remaining_qty < 0')
    log.assert('无 remaining_qty < 0 的容器', Number(negativeContainer[0].cnt) === 0)
  } finally {
    const summary = log.summary()
    await ctx.close()
    // 强制退出：避免残留句柄导致进程挂住 CI（process.exitCode 不强制退出）
    process.exit(summary.failed > 0 ? 1 : 0)
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
