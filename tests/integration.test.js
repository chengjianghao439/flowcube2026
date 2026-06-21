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
 *   6. 全局一致性不变量：inventory_stock = SUM(容器 remaining)，无负库存，reserved ≤ quantity
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

    // ── 3. 调拨 ──────────────────────────────────────────────────
    log.section('调拨（wh1 → wh2）')
    const wh1Before = (await stockQty(pool, product.id, warehouse.id)).quantity
    const wh2Before = (await stockQty(pool, product.id, wh2.id)).quantity
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
    await expectOk(log, await http.post(`/api/transfer/${transferId}/confirm`, { token }), '确认调拨单成功')
    await expectOk(log, await http.post(`/api/transfer/${transferId}/execute`, { token }), '执行调拨成功')

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

    // ── 5. 采购退货（出库） ──────────────────────────────────────
    log.section('采购退货（库存扣减）')
    const qtyBeforePR = (await stockQty(pool, product.id, warehouse.id)).quantity
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
    await expectOk(log, await http.post(`/api/returns/purchase/${prId}/confirm`, { token }), '确认采购退货单成功')
    await expectOk(log, await http.post(`/api/returns/purchase/${prId}/execute`, { token }), '执行采购退货成功')
    log.assert(`采购退货后 quantity = ${qtyBeforePR - PR_QTY}`, (await stockQty(pool, product.id, warehouse.id)).quantity === qtyBeforePR - PR_QTY)

    // ── 6. 销售退货（入库） ──────────────────────────────────────
    log.section('销售退货（库存入库）')
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
    await expectOk(log, await http.post(`/api/returns/sale/${srId}/confirm`, { token }), '确认销售退货单成功')
    await expectOk(log, await http.post(`/api/returns/sale/${srId}/execute`, { token }), '执行销售退货成功')
    log.assert(`销售退货后 quantity = ${qtyBeforeSR + SR_QTY}`, (await stockQty(pool, product.id, warehouse.id)).quantity === qtyBeforeSR + SR_QTY)
    const srContainer = await dbQuery(pool, "SELECT remaining_qty FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND source_ref_type='sale_return' ORDER BY id DESC LIMIT 1", [product.id, warehouse.id])
    log.assert(`销售退货生成新容器 remaining=${SR_QTY}`, srContainer.length > 0 && Number(srContainer[0].remaining_qty) === SR_QTY, JSON.stringify(srContainer))

    // ── 7. 全局一致性不变量 ──────────────────────────────────────
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
    if (summary.failed > 0) process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
