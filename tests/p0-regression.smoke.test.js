#!/usr/bin/env node
'use strict'

/**
 * P0 回归测试 — 锁死 2026-07 架构审计发现的五个 P0 缺陷
 *
 * 每个场景都对应一个曾经会「静默出错」的缺陷：不报错、界面正常、错误直接落进
 * 库存或账款。这类缺陷靠人工点测发现不了，必须由测试守住。
 *
 * P0-1 采购退货出库（无预占）会释放掉其它销售单的库存预占 → 超卖
 * P0-2 分批发货后取消剩余，预占永久泄漏 → 库存被锁死且无自愈路径
 * P0-3 短装收货后任务卡死在待上架、应付永不生成、采购单无法结案
 * P0-4 执行期改单丢失行级发货仓库 → 应收恒为 0、订单永远停在履约中
 * P0-5 出库明细 JOIN 缺仓库维度 → 多仓同商品订单库存被扣 N 倍
 *
 * 运行：node tests/p0-regression.smoke.test.js
 */

const path = require('path')
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

const containerEngine = require('../backend/src/engine/containerEngine')
const { moveStock, MOVE_TYPE } = require('../backend/src/engine/inventoryEngine')
const { reserve, releaseByRef } = require('../backend/src/engine/reservationEngine')
const shipSvc = require('../backend/src/modules/warehouse-tasks/warehouse-tasks.ship')

const OPERATOR = { userId: 1, realName: 'P0回归测试' }

/** 建一个本场景专用商品，避免与其它用例共享库存互相干扰 */
async function createTestProduct(pool, label) {
  const code = randomRef(`P0-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 10, 5)",
    [code, `P0测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `P0测试商品-${label}`, unit: '个' }
}

/** 通过容器引擎注入在库库存（走正规两段式：先待上架再转在库） */
async function seedStock(pool, productId, warehouseId, qty) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const { containerId } = await containerEngine.createContainer(conn, {
      productId,
      warehouseId,
      initialQty: qty,
      sourceType: containerEngine.SOURCE_TYPE.MANUAL,
      sourceRefId: 999999,
      remark: 'P0回归测试铺底库存',
      containerStatus: containerEngine.CONTAINER_STATUS.PENDING_PUTAWAY,
    })
    await containerEngine.promotePendingContainerToActive(conn, containerId, productId, warehouseId)
    await conn.commit()
    return containerId
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function readStock(pool, productId, warehouseId) {
  const [row] = await dbQuery(
    pool,
    'SELECT COALESCE(quantity,0) AS quantity, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [productId, warehouseId],
  )
  return { quantity: Number(row?.quantity ?? 0), reserved: Number(row?.reserved ?? 0) }
}

// ───────────────────────────────────────────────────────────────────────────
// P0-1：无预占的出库（采购退货）不得动别人的 reserved
// ───────────────────────────────────────────────────────────────────────────
async function scenarioPurchaseReturnKeepsReservation(ctx, log) {
  log.section('P0-1 采购退货出库不得释放其它销售单的库存预占')
  const { pool, warehouse } = ctx
  const product = await createTestProduct(pool, 'ret')
  await seedStock(pool, product.id, warehouse.id, 100)

  // 模拟已有一张销售单占用 60
  const conn0 = await pool.getConnection()
  try {
    await conn0.beginTransaction()
    await reserve(conn0, {
      productId: product.id, productName: product.name, warehouseId: warehouse.id,
      qty: 60, refType: 'sale_order', refId: 888801, refNo: 'P0-RET-SO',
    })
    await conn0.commit()
  } finally { conn0.release() }

  const before = await readStock(pool, product.id, warehouse.id)
  log.assert('前置：库存100 / 预占60', before.quantity === 100 && before.reserved === 60, JSON.stringify(before))

  // 采购退货出库 30 件：warehouse-tasks.ship 对 purchase_return 传 reservationRefType=null
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await moveStock(conn, {
      moveType: MOVE_TYPE.TASK_OUT,
      productId: product.id, productName: product.name, warehouseId: warehouse.id,
      qty: 30,
      refType: 'warehouse_task', refId: 888802, refNo: 'P0-RET-WT',
      reservationRefType: null, reservationRefId: null,   // ← 采购退货：无预占
      operatorId: OPERATOR.userId, operatorName: OPERATOR.realName,
    })
    await conn.commit()
  } finally { conn.release() }

  const after = await readStock(pool, product.id, warehouse.id)
  log.assert('库存已扣减到 70', after.quantity === 70, JSON.stringify(after))
  log.assert(
    '★P0-1 reserved 保持 60 不变（修复前会被误扣成 30 → 可用量虚高 → 超卖）',
    after.reserved === 60,
    `实际 reserved=${after.reserved}`,
  )
  log.assert(
    '★P0-1 可用量正确为 10（70-60），不是错误的 40',
    after.quantity - after.reserved === 10,
    `实际可用=${after.quantity - after.reserved}`,
  )
}

// ───────────────────────────────────────────────────────────────────────────
// P0-2：分批出库只按量核销预占，剩余部分仍可被 releaseByRef 释放
// ───────────────────────────────────────────────────────────────────────────
async function scenarioPartialShipReleasesRemainder(ctx, log) {
  log.section('P0-2 分批发货后取消剩余，预占必须能完整释放')
  const { pool, warehouse } = ctx
  const product = await createTestProduct(pool, 'batch')
  await seedStock(pool, product.id, warehouse.id, 100)

  const REF_ID = 888901
  const conn0 = await pool.getConnection()
  try {
    await conn0.beginTransaction()
    await reserve(conn0, {
      productId: product.id, productName: product.name, warehouseId: warehouse.id,
      qty: 100, refType: 'sale_order', refId: REF_ID, refNo: 'P0-BATCH-SO',
    })
    await conn0.commit()
  } finally { conn0.release() }

  // 第一批只发 40
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await moveStock(conn, {
      moveType: MOVE_TYPE.TASK_OUT,
      productId: product.id, productName: product.name, warehouseId: warehouse.id,
      qty: 40,
      refType: 'warehouse_task', refId: 888902, refNo: 'P0-BATCH-WT',
      reservationRefType: 'sale_order', reservationRefId: REF_ID,
      operatorId: OPERATOR.userId, operatorName: OPERATOR.realName,
    })
    await conn.commit()
  } finally { conn.release() }

  const mid = await readStock(pool, product.id, warehouse.id)
  log.assert('第一批出库后 reserved 降到 60', mid.reserved === 60, JSON.stringify(mid))

  const stillActive = await dbQuery(
    pool,
    'SELECT COALESCE(SUM(qty),0) AS q FROM stock_reservations WHERE ref_type=? AND ref_id=? AND status=1',
    ['sale_order', REF_ID],
  )
  log.assert(
    '★P0-2 未发部分仍保留为「预占中」记录 60（修复前整组被标记为已履行 → 记录归零）',
    Number(stillActive[0].q) === 60,
    `实际在册预占=${stillActive[0].q}`,
  )

  // 客户取消剩余 → 整单释放
  const conn2 = await pool.getConnection()
  try {
    await conn2.beginTransaction()
    await releaseByRef(conn2, 'sale_order', REF_ID)
    await conn2.commit()
  } finally { conn2.release() }

  const end = await readStock(pool, product.id, warehouse.id)
  log.assert(
    '★P0-2 取消后 reserved 完整归零（修复前会永久卡在 60，货在货架上却永远不可用）',
    end.reserved === 0,
    `实际 reserved=${end.reserved}`,
  )
  log.assert('库存量不受释放影响，仍为 60', end.quantity === 60, JSON.stringify(end))
}

// ───────────────────────────────────────────────────────────────────────────
// P0-3：短装收货全链路必须能走到底（任务完成 → 应付生成 → 采购单结案）
// ───────────────────────────────────────────────────────────────────────────
async function scenarioShortReceiveClosesOut(ctx, log, token) {
  log.section('P0-3 短装收货：结束收货 → 上架 → 自动结算 → 采购单结案')
  const { http, pool, warehouse, location, supplier, pdaHeaders } = ctx
  const product = await createTestProduct(pool, 'short')

  const poResp = await createPurchaseOrder(http, token, { supplier, warehouse, product, quantity: 10 })
  const poId = Number(poResp.data?.data?.id)
  await confirmPurchaseOrder(http, token, poId)
  const taskResp = await createInboundTaskFromPurchase(http, token, poId)
  const taskId = Number(taskResp.data?.data?.taskId)
  await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })

  // 供应商只送来 8 件（应到 10）
  const recvResp = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(),
    json: { productId: Number(product.id), packages: [{ qty: 8 }] },
  })
  log.assert('短装收货成功', recvResp.ok, JSON.stringify(recvResp.data).slice(0, 200))

  const [t1] = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [taskId])
  log.assert('未收满时任务停在收货中(2)', Number(t1.status) === 2, `status=${t1.status}`)

  const closeResp = await http.post(`/api/inbound-tasks/${taskId}/close-receiving`, { token })
  log.assert('可以提前结束收货', closeResp.ok, JSON.stringify(closeResp.data).slice(0, 200))

  const [t2] = await dbQuery(pool, 'SELECT status, closed_reason FROM inbound_tasks WHERE id=?', [taskId])
  log.assert(
    '结束收货后进入待上架(3)并标记 short_close',
    Number(t2.status) === 3 && t2.closed_reason === 'short_close',
    JSON.stringify(t2),
  )

  // 把收到的货全部上架
  const cResp = await http.get(`/api/inbound-tasks/${taskId}/containers`, { token })
  const waiting = cResp.data?.data?.waiting || cResp.data?.data?.list || []
  log.assert('存在待上架容器', waiting.length > 0, JSON.stringify(cResp.data).slice(0, 200))
  for (const c of waiting) {
    const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
      token, headers: pdaHeaders(),
      json: { containerId: Number(c.id), locationId: Number(location.id) },
    })
    log.assert(`容器 ${c.id} 上架成功`, put.ok, JSON.stringify(put.data).slice(0, 200))
  }

  const [t3] = await dbQuery(pool, 'SELECT status, audit_status FROM inbound_tasks WHERE id=?', [taskId])
  log.assert(
    '★P0-3 短装全部上架后收货订单完成(4)（修复前永久卡在待上架(3)，PDA 上却没有任何可上架容器）',
    Number(t3.status) === 4,
    `实际 status=${t3.status}`,
  )
  log.assert(
    '★P0-3 audit_status 置为已结算(1)',
    Number(t3.audit_status) === 1,
    `实际 audit_status=${t3.audit_status}`,
  )

  const [pay] = await dbQuery(pool, 'SELECT total_amount FROM payment_records WHERE type=1 AND order_id=?', [poId])
  log.assert(
    '★P0-3 应付账款按实收 8 件生成 = 80 元（修复前恒为不生成 → 货进了库却不欠供应商钱）',
    pay && Math.abs(Number(pay.total_amount) - 80) < 0.001,
    `实际应付=${pay ? pay.total_amount : '未生成'}`,
  )

  const closePo = await http.post(`/api/purchase/${poId}/close`, { token })
  log.assert(
    '★P0-3 采购单可以关闭剩余结案（修复前被 audit_status<>1 挡死，用户完全无路可走）',
    closePo.ok,
    JSON.stringify(closePo.data).slice(0, 200),
  )
  const [po] = await dbQuery(pool, 'SELECT status, closed_reason FROM purchase_orders WHERE id=?', [poId])
  log.assert('采购单已完成(3)并标记短装结案', Number(po.status) === 3 && po.closed_reason === 'short_close', JSON.stringify(po))
}

// ───────────────────────────────────────────────────────────────────────────
// P0-4：执行期改单后，行级发货仓库不能丢
// ───────────────────────────────────────────────────────────────────────────
async function scenarioAdjustKeepsWarehouse(ctx, log, token) {
  log.section('P0-4 执行期改单必须保留行级发货仓库')
  const { http, pool, warehouse, customer } = ctx
  const product = await createTestProduct(pool, 'adj')
  await seedStock(pool, product.id, warehouse.id, 100)

  const saleResp = await http.post('/api/sale', {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      remark: randomRef('p0-adj'),
      items: [{
        productId: Number(product.id), productCode: product.code, productName: product.name,
        unit: product.unit, quantity: 5, unitPrice: 10,
      }],
    },
  })
  const saleId = Number(saleResp.data?.data?.id)
  log.assert('销售单创建成功', !!saleId, JSON.stringify(saleResp.data).slice(0, 200))

  await http.post(`/api/sale/${saleId}/reserve`, { token })
  const shipResp = await http.post(`/api/sale/${saleId}/ship`, { token })
  log.assert('发起出库成功', shipResp.ok, JSON.stringify(shipResp.data).slice(0, 200))

  // 客户加量：5 → 8。
  // 注意：/adjust 复用 createSchema 校验，必须带齐建单字段（服务端只取 items，
  // 仓库仍以原明细行为准——这正是本用例要守住的行为）。
  const adjResp = await http.put(`/api/sale/${saleId}/adjust`, {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      items: [{
        productId: Number(product.id), productCode: product.code, productName: product.name,
        unit: product.unit, quantity: 8, unitPrice: 10,
      }],
    },
  })
  log.assert('改单成功', adjResp.ok, JSON.stringify(adjResp.data).slice(0, 300))

  const items = await dbQuery(
    pool,
    'SELECT id, warehouse_id, warehouse_name, quantity, dispatched FROM sale_order_items WHERE order_id=?',
    [saleId],
  )
  log.assert('改单后明细已重建', items.length === 1 && Number(items[0].quantity) === 8, JSON.stringify(items))
  log.assert(
    '★P0-4 warehouse_id 未丢失（修复前为 NULL → shipped_qty 永远回写不上 → 应收恒为 0）',
    items.every(i => i.warehouse_id != null),
    JSON.stringify(items),
  )
  log.assert(
    '★P0-4 warehouse_id 等于该单发货仓库',
    Number(items[0].warehouse_id) === Number(warehouse.id),
    `实际=${items[0].warehouse_id} 期望=${warehouse.id}`,
  )
  log.assert('★P0-4 warehouse_name 一并保留', !!items[0].warehouse_name, JSON.stringify(items[0]))
  log.assert('改单重建的行仍标记为已派发(dispatched=1)', Number(items[0].dispatched) === 1, JSON.stringify(items[0]))
}

// ───────────────────────────────────────────────────────────────────────────
// P0-5：多仓同商品订单，出库明细不得被 JOIN 放大
// ───────────────────────────────────────────────────────────────────────────
async function scenarioMultiWarehouseNoFanout(ctx, log, token) {
  log.section('P0-5 多仓同商品订单出库明细不得重复放大')
  const { http, pool, warehouse, customer } = ctx

  // 第二个仓库
  let [wh2] = await dbQuery(pool, "SELECT id, name FROM inventory_warehouses WHERE code='P0-WH2' AND deleted_at IS NULL")
  if (!wh2) {
    const [r] = await pool.query("INSERT INTO inventory_warehouses (name, code) VALUES ('P0第二仓库', 'P0-WH2')")
    wh2 = { id: r.insertId, name: 'P0第二仓库' }
  }

  const product = await createTestProduct(pool, 'multiwh')
  await seedStock(pool, product.id, warehouse.id, 50)
  await seedStock(pool, product.id, wh2.id, 50)

  const saleResp = await http.post('/api/sale', {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      remark: randomRef('p0-multiwh'),
      items: [{
        productId: Number(product.id), productCode: product.code, productName: product.name,
        unit: product.unit, quantity: 10, unitPrice: 10,
      }],
    },
  })
  const saleId = Number(saleResp.data?.data?.id)

  // 造出「同一商品分两个仓库发货」这一分仓订单的正常形态：
  // 第一行留在主仓库，另加一行走第二仓库（schema 层不强制唯一，是被支持的用法）
  await pool.query(
    `INSERT INTO sale_order_items (order_id, warehouse_id, warehouse_name, product_id, product_code, product_name, unit, quantity, unit_price, amount)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [saleId, wh2.id, wh2.name, product.id, product.code, product.name, product.unit, 5, 20, 100],
  )

  const itemsBefore = await dbQuery(pool, 'SELECT id, warehouse_id FROM sale_order_items WHERE order_id=?', [saleId])
  log.assert('订单含两行同商品、分属两个仓库', itemsBefore.length === 2, JSON.stringify(itemsBefore))

  await http.post(`/api/sale/${saleId}/reserve`, { token })
  const shipResp = await http.post(`/api/sale/${saleId}/ship`, { token })
  log.assert('分仓发起出库成功', shipResp.ok, JSON.stringify(shipResp.data).slice(0, 300))

  const tasks = await dbQuery(pool, 'SELECT id, warehouse_id FROM warehouse_tasks WHERE sale_order_id=? ORDER BY id', [saleId])
  log.assert('按仓库分别建了 2 个仓库任务', tasks.length === 2, JSON.stringify(tasks))

  for (const t of tasks) {
    const [{ n }] = await dbQuery(pool, 'SELECT COUNT(*) AS n FROM warehouse_task_items WHERE task_id=?', [t.id])
    const ctxItems = await shipSvc.getShipContext(Number(t.id))
    log.assert(
      `★P0-5 任务#${t.id}（仓库${t.warehouse_id}）出库明细 ${ctxItems.items.length} 条 == 任务明细 ${n} 条（修复前会放大成 ${Number(n) * 2} 条 → 库存扣 2 倍）`,
      ctxItems.items.length === Number(n),
      `实际 ${ctxItems.items.length} vs ${n}`,
    )
    log.assert(
      `任务#${t.id} 出库仓库取自任务自身`,
      Number(ctxItems.warehouseId) === Number(t.warehouse_id),
      `实际=${ctxItems.warehouseId}`,
    )
  }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败，无法执行 P0 回归测试')

    await scenarioPurchaseReturnKeepsReservation(ctx, log)
    await scenarioPartialShipReleasesRemainder(ctx, log)
    await scenarioShortReceiveClosesOut(ctx, log, token)
    await scenarioAdjustKeepsWarehouse(ctx, log, token)
    await scenarioMultiWarehouseNoFanout(ctx, log, token)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[P0-REGRESSION] 未捕获异常：', e)
  process.exit(1)
})
