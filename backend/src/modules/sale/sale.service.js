const { normalizeProduct } = require('../logistics/shipping-products')
const { snapshotItemCommitments, restoreItemCommitments } = require('../fulfillment/fulfillment.sale-items')
const { loadSalePresentation } = require('./sale.presentation')
const { pool } = require('../../config/db')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { normalizePagination } = require('../../utils/pagination')
const AppError = require('../../utils/AppError')
const { reserve, releaseByRef, partialReleaseByProduct } = require('../../engine/reservationEngine')
const { getStockProjection } = require('../../engine/containerEngine')
const { lockExpectedPurchaseOrders } = require('../../utils/expectedStock')
const { getAvailabilityByProducts } = require('../inventory/inventory.service')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { foldEntryItems, round2 } = require('../../utils/unitConversion')  // 多单位折算（文档03 · 方案A，共享util）
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { getCustomerCreditUsed, hasCreditOverridePermission } = require('../../utils/creditExposure')
const creditOverrideSvc = require('../credit-overrides/credit-overrides.service')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { SALE_STATUS, SALE_STATUS_NAME } = require('../../constants/saleOrderStatus')
const { SETTLEMENT_TYPE, buildDueDateSql, normalizeSettlementType } = require('../../constants/settlementType')
const { WT_STATUS_NAME, WT_STATUS_ACTIVE } = require('../../constants/warehouseTaskStatus')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { beijingTodayYmd } = require('../../utils/backendTime')
const adjustSvc = require('../warehouse-tasks/warehouse-tasks.adjust')
const { WT_EVENT, record: recordWtEvent } = require('../warehouse-tasks/warehouse-task-events.service')
const {
  getNetOrderAmount,
  calculateDiscountApplied,
  scansForSaleItem,
  selectDispatchRows,
  assertDiscountWithinTotal,
  saleOperationAction,
} = require('./sale.contracts')

const FREIGHT_TYPE = { 1:'寄付', 2:'到付', 3:'第三方付' }
const fmt = row => ({
  id:row.id, orderNo:row.order_no,
  customerId:row.customer_id, customerName:row.customer_name,
  warehouseId:row.warehouse_id, warehouseName:row.warehouse_name,
  status:row.status, statusName:SALE_STATUS_NAME[row.status],
  saleDate:row.sale_date, totalAmount:Number(row.total_amount), remark:row.remark,
  discountAmount: Number(row.discount_amount || 0),
  taskId:row.warehouse_task_id||row.task_id||null,
  taskNo:row.warehouse_task_no||row.task_no||null,
  executionAdjustmentBlocked: Number(row.execution_task_count || 0) > 1 || (Boolean(row.task_id) && Number(row.incomplete_dispatch_count || 0) > 0),
  warehouseTaskStatus: row.warehouse_task_status != null ? Number(row.warehouse_task_status) : null,
  warehouseTaskStatusName: row.warehouse_task_status != null
    ? (WT_STATUS_NAME[Number(row.warehouse_task_status)] || null)
    : null,
  warehouseTaskCancelRequestedAt: row.warehouse_task_cancel_requested_at || null,
  warehouseTaskAdjustmentRequestedAt: row.warehouse_task_adjustment_requested_at || null,
  // 发货进度（分仓/分批）：老单/未发货订单 shipped=0，isMultiWarehouse=false，展示与旧版一致
  orderedTotalQty: row.ordered_total_qty != null ? Number(row.ordered_total_qty) : null,
  shippedTotalQty: row.shipped_total_qty != null ? Number(row.shipped_total_qty) : null,
  warehouseCount: row.warehouse_count != null ? Number(row.warehouse_count) : null,
  isMultiWarehouse: row.warehouse_count != null ? Number(row.warehouse_count) > 1 : false,
  // 分批：仍有未派发到仓库任务的明细行 → 履约中可「继续发货」
  hasUndispatchedItems: row.undispatched_count != null ? Number(row.undispatched_count) > 0 : false,
  closedReason: row.closed_reason || null,
  // 回款：独立于订单状态展示（月结/现结账期不同，混进状态徽章看不清）。
  // receivableStatus 为 null 表示还没生成应收记录（订单还没发过货）。
  receivableStatus: row.receivable_status != null ? Number(row.receivable_status) : null,
  receivableStatusName: row.receivable_status != null ? (RECEIVABLE_STATUS_NAME[Number(row.receivable_status)] || null) : null,
  receivableDueDate: row.receivable_due_date || null,
  receivableBalance: row.receivable_balance != null ? Number(row.receivable_balance) : null,
  // 应收结算方式：应收快照优先，未出库回退客户主数据（COALESCE 兜底为月结），恒非 null。
  receivableSettlementType: row.receivable_settlement_type != null ? Number(row.receivable_settlement_type) : null,
  // 逾期 = 未付清（status 非 3，含未出库 null）且到期日严格早于北京今天（当天到期算最后付款日，不算逾期）。
  // 统一口径：对账页 SQL 用 pr.due_date < CURDATE()（当天不算逾期），之前这里用
  // new Date(due_date).getTime() < Date.now() 会把「今天到期」从凌晨就误判逾期。
  // due_date 是 DATE 列，mysql2 在 timezone=+08:00 下解析成北京午夜（UTC 前一天 16:00Z），
  // beijingTodayYmd 能把两边都还原成北京 YYYY-MM-DD 再做字符串比较。
  receivableOverdue: Number(row.receivable_status) !== 3
    && row.receivable_due_date != null
    && beijingTodayYmd(new Date(row.receivable_due_date)) < beijingTodayYmd(),
  carrierId:row.carrier_id||null,
  shippingProduct: row.shipping_product || null,
  carrier: row.carrier_name || row.carrier || null,   // 优先承运商表名称，回退文本字段
  freightType:row.freight_type||null,
  freightTypeName:row.freight_type ? (FREIGHT_TYPE[row.freight_type]||null) : null,
  receiverName:row.receiver_name||null, receiverPhone:row.receiver_phone||null,
  receiverAddress:row.receiver_address||null,
  operatorId:row.operator_id, operatorName:row.operator_name, createdAt:row.created_at,
})

// sale_orders.task_id 保存最近创建的任务，供列表快速展示当前履约状态；分仓或分批时
// 一个销售单可关联多个 warehouse_tasks，详情与业务判断必须按 sale_order_id 查询完整任务集。
const latestWarehouseTaskJoin = `
  LEFT JOIN warehouse_tasks wt_by_id ON wt_by_id.id = so.task_id AND wt_by_id.deleted_at IS NULL
`

const warehouseTaskProjection = `
  (SELECT COUNT(*) FROM warehouse_tasks wt_count WHERE wt_count.sale_order_id=so.id AND wt_count.deleted_at IS NULL) AS execution_task_count,
  (SELECT COUNT(*) FROM sale_order_items si_count WHERE si_count.order_id=so.id AND (si_count.dispatched_qty <> si_count.quantity OR si_count.reserved_qty <> si_count.quantity)) AS incomplete_dispatch_count,
  wt_by_id.id AS warehouse_task_id,
  wt_by_id.task_no AS warehouse_task_no,
  wt_by_id.status AS warehouse_task_status,
  wt_by_id.cancel_requested_at AS warehouse_task_cancel_requested_at,
  wt_by_id.adjustment_requested_at AS warehouse_task_adjustment_requested_at
`

// 发货进度汇总（分仓/分批展示用）：一次聚合避免逐行相关子查询
const itemAggJoin = `
  LEFT JOIN (
    SELECT order_id,
           SUM(quantity) AS ordered_total_qty,
           SUM(shipped_qty) AS shipped_total_qty,
           COUNT(DISTINCT warehouse_id) AS warehouse_count,
           SUM(CASE WHEN dispatched_qty < reserved_qty THEN 1 ELSE 0 END) AS undispatched_count
    FROM sale_order_items GROUP BY order_id
  ) soi_agg ON soi_agg.order_id = so.id
`
const itemAggProjection = `
  soi_agg.ordered_total_qty, soi_agg.shipped_total_qty, soi_agg.warehouse_count,
  soi_agg.undispatched_count
`

// 回款信息（不改订单状态机，独立于订单状态展示）：payment_records type=2（应收）。
// 结算方式读「应收快照优先、回退客户主数据」——未出库订单还没有应收记录，只能靠
// 客户主数据的 settlement_type 区分现结/月结（COALESCE 默认月结，与 normalizeSettlementType 一致）。
const paymentJoin = `
  LEFT JOIN payment_records pr_recv ON pr_recv.type = 2 AND pr_recv.order_id = so.id
  LEFT JOIN sale_customers cust ON cust.id = so.customer_id AND cust.deleted_at IS NULL
`
const paymentProjection = `
  pr_recv.status AS receivable_status,
  CASE
    WHEN pr_recv.due_date IS NOT NULL THEN pr_recv.due_date
    WHEN COALESCE(pr_recv.settlement_type, cust.settlement_type, 2) = ${SETTLEMENT_TYPE.CASH} THEN DATE(so.created_at)
    ELSE NULL
  END AS receivable_due_date,
  pr_recv.balance AS receivable_balance,
  COALESCE(pr_recv.settlement_type, cust.settlement_type, 2) AS receivable_settlement_type
`
const RECEIVABLE_STATUS_NAME = { 1: '未付', 2: '部分付', 3: '已付清' }

const genOrderNo = conn => generateDailyCode(conn, 'SO', 'sale_orders', 'order_no')

// 拒绝同一 (商品, 发货仓库) 的重复明细行：出库时 warehouse_task_items↔sale_order_items 的
// JOIN 会因重复行放大成 N 倍，assertNoShipItemFanout 永久 409 卡死出库（扫描 low-8）。
function assertNoDuplicateSaleItemLines(items, fallbackWarehouseId) {
  const seen = new Set()
  for (const it of items) {
    const whId = it.warehouseId ? Number(it.warehouseId) : Number(fallbackWarehouseId)
    const key = `${Number(it.productId)}:${whId}`
    if (seen.has(key)) {
      throw new AppError('同一商品在同一发货仓库出现了重复明细行，请合并为一行后再提交', 400)
    }
    seen.add(key)
  }
}

async function hydrateSaleInput(conn, { customerId, warehouseId, carrierId = null, shippingProduct = null, items, scopeWarehouseIds }) {
  assertInScope(scopeWarehouseIds, warehouseId, '销售单')
  const [[customer]] = await conn.query(
    'SELECT id, name, is_active FROM sale_customers WHERE id=? AND deleted_at IS NULL',
    [customerId],
  )
  if (!customer) throw new AppError('客户不存在', 404)
  if (!customer.is_active) throw new AppError('该客户已停用，无法保存销售单', 400)

  const warehouseIds = [...new Set([warehouseId, ...items.map(item => item.warehouseId || warehouseId)].map(Number))]
  const [warehouses] = await conn.query(
    'SELECT id, name, is_active FROM inventory_warehouses WHERE id IN (?) AND deleted_at IS NULL',
    [warehouseIds],
  )
  const warehouseById = new Map(warehouses.map(row => [Number(row.id), row]))
  for (const id of warehouseIds) {
    assertInScope(scopeWarehouseIds, id, '销售单')
    const warehouse = warehouseById.get(id)
    if (!warehouse) throw new AppError(`仓库 ${id} 不存在`, 404)
    if (!warehouse.is_active) throw new AppError(`仓库「${warehouse.name}」已停用，无法保存销售单`, 400)
  }

  const productIds = [...new Set(items.map(item => Number(item.productId)))]
  const [products] = await conn.query(
    `SELECT id, code, name, unit, article_number, spec, color, cost_price, is_active
       FROM product_items WHERE id IN (?) AND deleted_at IS NULL`,
    [productIds],
  )
  const productById = new Map(products.map(row => [Number(row.id), row]))
  let carrier = null
  let product = null
  if (carrierId != null) {
    const [[carrierRow]] = await conn.query(
      'SELECT id, name, is_active, platform_code, shipping_product FROM carriers WHERE id = ? AND deleted_at IS NULL',
      [Number(carrierId)],
    )
    if (!carrierRow) throw new AppError('承运商不存在', 404)
    if (!carrierRow.is_active) throw new AppError(`承运商「${carrierRow.name}」已停用，无法保存销售单`, 400)
    carrier = carrierRow.name
    product = normalizeProduct(carrierRow.platform_code, shippingProduct || carrierRow.shipping_product)
  }
  const hydratedItems = items.map(item => {
    const product = productById.get(Number(item.productId))
    if (!product) throw new AppError(`商品 ${item.productId} 不存在`, 404)
    if (!product.is_active) throw new AppError(`商品「${product.name}」已停用，无法保存销售单`, 400)
    const itemWarehouseId = Number(item.warehouseId || warehouseId)
    return {
      ...item,
      productCode: product.code,
      productName: product.name,
      articleNumber: product.article_number || null,
      spec: product.spec || null,
      color: product.color || null,
      unit: product.unit,
      costPrice: Number(product.cost_price) || 0,
      warehouseId: itemWarehouseId,
      warehouseName: warehouseById.get(itemWarehouseId).name,
    }
  })
  return {
    customerName: customer.name,
    warehouseName: warehouseById.get(Number(warehouseId)).name,
    carrier,
    shippingProduct: product,
    items: hydratedItems,
  }
}

async function appendSaleEvent(conn, saleOrderId, eventType, title, description, operator = null, payload = null) {
  await conn.query(
    `INSERT INTO sale_order_events (sale_order_id,event_type,title,description,payload_json,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?)`,
    [
      saleOrderId,
      eventType,
      title,
      description || null,
      payload ? JSON.stringify(payload) : null,
      operator?.userId || null,
      operator?.realName || null,
    ],
  )
}

async function buildPricingEvents(conn, saleOrderId, items, operator) {
  for (const item of items) {
    const costPrice = Number(item.costPrice ?? 0)
    const resolvedPrice = item.resolvedPrice != null ? Number(item.resolvedPrice) : null
    const unitPrice = Number(item.unitPrice || 0)
    if (item.priceSource === 'manual') {
      const parts = [`${item.productName} 单价手工改为 ¥${unitPrice.toFixed(2)}`]
      if (resolvedPrice != null) parts.push(`等级价参考 ¥${resolvedPrice.toFixed(2)}`)
      await appendSaleEvent(conn, saleOrderId, 'pricing_override', '手工改价', parts.join('，'), operator, {
        productId: item.productId,
        productName: item.productName,
        unitPrice,
        resolvedPrice,
        resolvedPriceLevel: item.resolvedPriceLevel || null,
      })
    }
    if (costPrice > 0 && unitPrice < costPrice) {
      await appendSaleEvent(
        conn,
        saleOrderId,
        'below_cost',
        '低于进价销售预警',
        `${item.productName} 销售价 ¥${unitPrice.toFixed(2)} 低于当前进价 ¥${costPrice.toFixed(2)}`,
        operator,
        { productId: item.productId, productName: item.productName, unitPrice, costPrice },
      )
    }
  }
}

async function syncPickingByWarehouseTaskWithinTransaction(conn, id, { taskId = null, taskNo = null } = {}) {
  const orderRow = await lockStatusRow(conn, {
    table: 'sale_orders',
    id,
    columns: 'id, order_no, status, task_id, task_no',
    entityName: '销售单',
  })
  if (Number(orderRow.status) === 3) return fmt(orderRow)
  const rule = assertStatusAction('sale', 'ship', orderRow.status)
  await compareAndSetStatus(conn, {
    table: 'sale_orders',
    id,
    fromStatus: rule.from,
    toStatus: rule.to,
    entityName: '销售单',
    extraSet: {
      ...(taskId ? { task_id: Number(taskId) } : {}),
      ...(taskNo ? { task_no: String(taskNo) } : {}),
    },
  })
  await appendSaleEvent(
    conn,
    id,
    'warehouse_ready_to_sort',
    '拣货完成',
    `销售单 ${orderRow.order_no} 已进入待分拣阶段`,
    null,
    { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
  )
  return {
    ...fmt(orderRow),
    status: rule.to,
    statusName: SALE_STATUS_NAME[rule.to],
    taskId: taskId != null ? Number(taskId) : (orderRow.task_id || null),
    taskNo: taskNo || orderRow.task_no || null,
  }
}

// 应收全量重算：应收 = SUM(shipped_qty × unit_price)，每次出库后重算 upsert。
// 复用采购应付的幂等模式（见 inbound-tasks.settle.recomputePurchasePayable）——分批出库、
// 退货冲减任意顺序都不会重复计账。应收视为已确认（确认闸门只针对采购自动结算的应付）。
async function recomputeSaleReceivable(conn, saleOrderId) {
  const [[{ amount }]] = await conn.query(
    'SELECT COALESCE(SUM(shipped_qty * unit_price), 0) AS amount FROM sale_order_items WHERE order_id = ?',
    [saleOrderId],
  )
  const grossTotal = Number(amount) || 0
  // 整单折扣（P2-4）：按发货比例分摊折扣到已发部分。总折扣 × (已发原值 / 订单原值)，
  // 分批发货时只扣已发那部分的折扣，未发部分留到后续批次。
  const [[{ orderTotal, discount }]] = await conn.query(
    `SELECT COALESCE(so.total_amount, 0) AS orderTotal,
            COALESCE(so.discount_amount, 0) AS discount
     FROM sale_orders so
     WHERE so.id = ?`,
    [saleOrderId],
  )
  const discountApplied = calculateDiscountApplied({
    discount,
    shippedGross: grossTotal,
    orderGross: orderTotal,
  })
  // 扣除该销售单下所有「已退货入库(3)」的销售退货金额（与采购应付 recomputePurchasePayable 对称）。
  // 否则分批/分仓发货时，中途完成的销售退货冲减（syncSaleReturnCompleted 增量减）会被下一批
  // 出库的全量重算覆盖回全额，客户被静默多计应收——这正是采购侧 P0-1 的销售镜像。
  // 口径：按实际质检合格入库量（checked_qty − rejected_qty）× 退货单价，与 syncSaleReturnCompleted
  // 严格一致（质检不合格部分不退客户，业务决策 2026-07-28）；全量覆盖不与增量叠加，故不双重扣。
  const [[{ returnedAmount }]] = await conn.query(
    `SELECT COALESCE(SUM((rti.checked_qty - rti.rejected_qty) * sri.unit_price), 0) AS returnedAmount
       FROM sale_returns sr
       JOIN return_tasks rt ON rt.return_id = sr.id AND rt.return_type = 'sale' AND rt.deleted_at IS NULL
       JOIN return_task_items rti ON rti.task_id = rt.id
       JOIN sale_return_items sri ON sri.id = rti.return_item_id
      WHERE sr.sale_order_id = ? AND sr.deleted_at IS NULL AND sr.status = 3`,
    [saleOrderId],
  )
  const total = Math.max(0, grossTotal - (Number(returnedAmount) || 0) - discountApplied)
  if (total <= 0) {
    const [[existing]] = await conn.query('SELECT id FROM payment_records WHERE type = 2 AND order_id = ?', [saleOrderId])
    if (!existing) return
  }
  const [[row]] = await conn.query(
    `SELECT so.order_no, so.customer_name, so.created_at,
            COALESCE(c.settlement_type, 2) AS settlement_type,
            COALESCE(c.payment_terms_days, 30) AS terms
     FROM sale_orders so LEFT JOIN sale_customers c ON c.id = so.customer_id WHERE so.id = ?`,
    [saleOrderId],
  )
  if (!row) return
  // 到期日按客户主数据的结算方式 + 账期天数计算：现结从销售单创建日起算，
  // 月结从本次出库结算时刻起算（见 constants/settlementType.js 的对照表）。
  //
  // settlement_type 与 due_date 一样只在首次 INSERT 时写入，**不在分批发货重算时更新**：
  // 账款是历史事实，当初按什么条件结算就是什么条件；之后把客户从现结改成月结，
  // 不该把这批老账追溯改写成月结（迁移 136）。后续批次只重算金额。
  const settlementSnapshot = normalizeSettlementType(row.settlement_type)
  const due = buildDueDateSql(settlementSnapshot, row.terms, row.created_at)
  await conn.query(
    `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status, settlement_type, due_date)
     VALUES (2, ?, ?, ?, ?, 0, ?, 1, 1, ?, ${due.expr})
     ON DUPLICATE KEY UPDATE
       total_amount = VALUES(total_amount),
       balance = GREATEST(0, VALUES(total_amount) - paid_amount),
       status = CASE WHEN paid_amount >= VALUES(total_amount) THEN 3
                     WHEN paid_amount > 0 THEN 2 ELSE 1 END`,
    [saleOrderId, row.order_no, row.customer_name, total, total, settlementSnapshot, ...due.params],
  )
}

// 某个仓库任务出库完成时的回调：累加该任务实发量到对应明细行 shipped_qty、重算应收、
// 判断整单是否全部发完（所有行 shipped_qty>=quantity）。全发完 → 3→4；否则订单留在 3（履约中）。
// 单仓订单只有一个任务，一次就全发完，行为与旧版一致。
async function syncShippedByWarehouseTaskWithinTransaction(conn, id, { taskId = null, taskNo = null } = {}) {
  const orderRow = await lockStatusRow(conn, {
    table: 'sale_orders',
    id,
    columns: 'id, order_no, status, task_id, task_no, warehouse_id',
    entityName: '销售单',
  })

  // 1. 累加本任务实发量：按 warehouse_task_items.picked_qty 回写到对应明细行
  //    （一个商品只在一个仓库，用 product_id + 任务仓库 精确定位明细行）
  if (taskId) {
    const [[task]] = await conn.query('SELECT warehouse_id FROM warehouse_tasks WHERE id = ?', [taskId])
    const taskWhId = task ? Number(task.warehouse_id) : Number(orderRow.warehouse_id)
    const [taskItems] = await conn.query(
      'SELECT product_id, picked_qty FROM warehouse_task_items WHERE task_id = ?',
      [taskId],
    )
    for (const ti of taskItems) {
      await conn.query(
        `UPDATE sale_order_items
         SET shipped_qty = LEAST(quantity, shipped_qty + ?)
         WHERE order_id = ? AND product_id = ? AND warehouse_id = ?`,
        [Number(ti.picked_qty), id, ti.product_id, taskWhId],
      )
    }
  }

  // 2. 应收全量重算（按实发汇总）
  await recomputeSaleReceivable(conn, id)

  // 3. 判断整单是否全部发完
  const [[{ pending }]] = await conn.query(
    'SELECT COUNT(*) AS pending FROM sale_order_items WHERE order_id = ? AND shipped_qty < quantity',
    [id],
  )
  const allShipped = Number(pending) === 0

  if (allShipped) {
    const rule = assertStatusAction('sale', 'completeShip', orderRow.status)
    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
    })
    await appendSaleEvent(
      conn, id, 'warehouse_shipped', '已完成出库',
      `销售单 ${orderRow.order_no} 已全部出库`,
      null,
      { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
    )
    return { ...fmt(orderRow), status: rule.to, statusName: SALE_STATUS_NAME[rule.to] }
  }

  // 部分出库：订单保持"履约中(3)"，等其余仓库任务陆续出库
  await appendSaleEvent(
    conn, id, 'warehouse_partial_shipped', '部分出库',
    `销售单 ${orderRow.order_no} 部分商品已出库，仍有未发部分`,
    null,
    { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
  )
  return { ...fmt(orderRow), status: Number(orderRow.status), statusName: SALE_STATUS_NAME[Number(orderRow.status)] }
}

async function syncCancelledByWarehouseTaskWithinTransaction(conn, id, { taskId = null, taskNo = null } = {}) {
  const orderRow = await lockStatusRow(conn, {
    table: 'sale_orders',
    id,
    columns: 'id, order_no, status',
    entityName: '销售单',
  })
  if (Number(orderRow.status) === 5) return fmt(orderRow)
  const rule = assertStatusAction('sale', 'cancel', orderRow.status)
  await compareAndSetStatus(conn, {
    table: 'sale_orders',
    id,
    fromStatus: rule.from,
    toStatus: rule.to,
    entityName: '销售单',
  })
  await appendSaleEvent(
    conn,
    id,
    'warehouse_task_cancelled',
    '仓库任务已取消',
    `销售单 ${orderRow.order_no} 对应的仓库任务已取消`,
    null,
    { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
  )
  return {
    ...fmt(orderRow),
    status: rule.to,
    statusName: SALE_STATUS_NAME[rule.to],
  }
}

function mapTimeline(rows, order) {
  const base = rows.some(r => r.event_type === 'created') ? [] : [{
    id: `created-${order.id}`,
    eventType: 'created',
    title: '创建订单',
    description: `销售单 ${order.orderNo} 已创建`,
    createdBy: order.operatorId,
    createdByName: order.operatorName,
    createdAt: order.createdAt,
    payload: null,
  }]
  const mapped = rows.map(r => ({
    id: r.id,
    eventType: r.event_type,
    title: r.title,
    description: r.description,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    payload: r.payload_json
      ? (typeof r.payload_json === 'string'
        ? (() => { try { return JSON.parse(r.payload_json) } catch { return null } })()
        : r.payload_json)
      : null,
  }))
  return [...base, ...mapped].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

async function findAll({ page=1, pageSize=20, keyword='', status=null, productId=null, customerId=null, warehouseId=null, startDate=null, endDate=null, remark=null, operatorId=null, scopeWarehouseIds=null, focus=null }) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const params=[]
  const countParams=[]
  let cond=''
  let countCond=''
  if (keyword) {
    const like = `%${keyword}%`
    cond += ' AND (so.order_no LIKE ? OR so.customer_name LIKE ?)'
    countCond += ' AND (order_no LIKE ? OR customer_name LIKE ?)'
    params.push(like, like)
    countParams.push(like, like)
  }
  if (productId) {
    cond += ' AND EXISTS (SELECT 1 FROM sale_order_items soi WHERE soi.order_id = so.id AND soi.product_id = ?)'
    countCond += ' AND EXISTS (SELECT 1 FROM sale_order_items soi WHERE soi.order_id = sale_orders.id AND soi.product_id = ?)'
    params.push(productId)
    countParams.push(productId)
  }
  if (customerId) {
    cond += ' AND so.customer_id=?'
    countCond += ' AND customer_id=?'
    params.push(customerId)
    countParams.push(customerId)
  }
  if (warehouseId) {
    cond += ' AND so.warehouse_id=?'
    countCond += ' AND warehouse_id=?'
    params.push(warehouseId)
    countParams.push(warehouseId)
  }
  if (startDate) {
    // 半开区间写法（DATE(col)>=? 会废掉 (status,created_at) 索引）：start 从当天 00:00 起
    cond += ' AND so.created_at >= ?'
    countCond += ' AND created_at >= ?'
    params.push(`${startDate} 00:00:00`)
    countParams.push(`${startDate} 00:00:00`)
  }
  if (endDate) {
    cond += ' AND so.created_at < DATE_ADD(?, INTERVAL 1 DAY)'
    countCond += ' AND created_at < DATE_ADD(?, INTERVAL 1 DAY)'
    params.push(endDate)
    countParams.push(endDate)
  }
  if (remark) {
    cond += ' AND so.remark LIKE ?'
    countCond += ' AND remark LIKE ?'
    params.push(`%${remark}%`)
    countParams.push(`%${remark}%`)
  }
  if (operatorId) {
    cond += ' AND so.operator_id=?'
    countCond += ' AND operator_id=?'
    params.push(operatorId)
    countParams.push(operatorId)
  }
  const scope = scopeFilter(scopeWarehouseIds, 'so.warehouse_id')
  if (scope.sql) {
    cond += scope.sql
    countCond += scopeFilter(scopeWarehouseIds, 'warehouse_id').sql
    params.push(...scope.params)
    countParams.push(...scope.params)
  }
  if (Array.isArray(scopeWarehouseIds) && scopeWarehouseIds.length) {
    cond += ' AND NOT EXISTS (SELECT 1 FROM sale_order_items soi_scope WHERE soi_scope.order_id=so.id AND soi_scope.warehouse_id NOT IN (?))'
    countCond += ' AND NOT EXISTS (SELECT 1 FROM sale_order_items soi_scope WHERE soi_scope.order_id=sale_orders.id AND soi_scope.warehouse_id NOT IN (?))'
    params.push(scopeWarehouseIds)
    countParams.push(scopeWarehouseIds)
  }
  const pendingTask = alias => `EXISTS (SELECT 1 FROM warehouse_tasks focus_task WHERE focus_task.sale_order_id=${alias}.id AND focus_task.deleted_at IS NULL AND (focus_task.cancel_requested_at IS NOT NULL OR focus_task.adjustment_requested_at IS NOT NULL))`
  const pendingCredit = alias => `EXISTS (SELECT 1 FROM sale_credit_overrides focus_credit WHERE focus_credit.sale_order_id=${alias}.id AND focus_credit.deleted_at IS NULL AND focus_credit.status=2)`
  if (focus === 'pending') {
    cond += ` AND (so.status IN (1,2,3,6) OR ${pendingTask('so')})`
    countCond += ` AND (status IN (1,2,3,6) OR ${pendingTask('sale_orders')})`
  }
  const orderSql = focus === 'pending' ? `CASE WHEN ${pendingTask('so')} THEN 0 WHEN ${pendingCredit('so')} THEN 1 ELSE 2 END, so.created_at ASC,so.id ASC` : 'so.created_at DESC,so.id DESC'
  const [statusRows] = await pool.query(
    `SELECT so.status, COUNT(*) AS count FROM sale_orders so WHERE so.deleted_at IS NULL ${cond} GROUP BY so.status`, params,
  )
  const statusCounts = Object.fromEntries(statusRows.map(r => [String(r.status), Number(r.count)]))
  if (status) {
    cond += ' AND so.status=?'
    countCond += ' AND status=?'
    params.push(status)
    countParams.push(status)
  }
  // 两段式列表查询（性能）：itemAggJoin 是对整张 sale_order_items 的全量 GROUP BY 派生表，
  // 直接 LEFT JOIN 时每翻一页都全表重建一次。改为先分页取本页订单 id，再对
  // 本页 id 做 IN 聚合，明细表走 idx_order_id，翻页成本与数据总量解耦。
  const [pageRows] = await pool.query(
    `SELECT so.*, ${warehouseTaskProjection}, ${paymentProjection}
     FROM sale_orders so
     ${latestWarehouseTaskJoin}
     ${paymentJoin}
     WHERE so.deleted_at IS NULL ${cond}
     ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const pageIds = pageRows.map(r => r.id)
  const aggMap = new Map()
  if (pageIds.length) {
    const [aggRows] = await pool.query(
      `SELECT order_id,
              SUM(quantity) AS ordered_total_qty,
              SUM(shipped_qty) AS shipped_total_qty,
              COUNT(DISTINCT warehouse_id) AS warehouse_count,
              SUM(CASE WHEN dispatched_qty < reserved_qty THEN 1 ELSE 0 END) AS undispatched_count
       FROM sale_order_items WHERE order_id IN (?) GROUP BY order_id`,
      [pageIds],
    )
    for (const a of aggRows) aggMap.set(Number(a.order_id), a)
  }
  const rows = pageRows.map(r => ({ ...r, ...(aggMap.get(r.id) || {}) }))
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_orders WHERE deleted_at IS NULL ${countCond}`,countParams)
  const presentation = await loadSalePresentation(pool, pageIds)
  return { list:rows.map(r => ({ ...fmt(r), ...presentation.get(Number(r.id)) })), statusCounts, pagination:{page, pageSize: ps, total} }
}

async function findById(id, scopeWarehouseIds = null) {
  const [rows] = await pool.query(
    `SELECT so.*, c.name AS carrier_name, ${warehouseTaskProjection}, ${itemAggProjection}, ${paymentProjection}
     FROM sale_orders so
     LEFT JOIN carriers c ON c.id = so.carrier_id AND c.deleted_at IS NULL
     ${latestWarehouseTaskJoin}
     ${itemAggJoin}
     ${paymentJoin}
     WHERE so.id=? AND so.deleted_at IS NULL`,
    [id]
  )
  if(!rows[0]) throw new AppError('销售单不存在',404)
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '销售单')
  const order = { ...fmt(rows[0]), ...(await loadSalePresentation(pool, [Number(id)])).get(Number(id)) }

  // 分仓：一个订单可能有多个仓库任务，详情页返回任务列表（前端展示各仓进度）
  const [taskRows] = await pool.query(
    `SELECT id, task_no, warehouse_id, warehouse_name, status,
            cancel_requested_at, adjustment_requested_at, shipped_at
     FROM warehouse_tasks WHERE sale_order_id = ? AND deleted_at IS NULL ORDER BY id`,
    [id],
  )
  order.tasks = taskRows.map(t => ({
    taskId: Number(t.id),
    taskNo: t.task_no,
    warehouseId: t.warehouse_id != null ? Number(t.warehouse_id) : null,
    warehouseName: t.warehouse_name,
    status: Number(t.status),
    statusName: WT_STATUS_NAME[Number(t.status)] || null,
    cancelRequestedAt: t.cancel_requested_at || null,
    adjustmentRequestedAt: t.adjustment_requested_at || null,
    shippedAt: t.shipped_at || null,
  }))
  const [items] = await pool.query(
    `SELECT soi.*, p.cost_price
     FROM sale_order_items soi
     LEFT JOIN product_items p ON p.id = soi.product_id
     WHERE soi.order_id=?`,
    [id],
  )
  for (const item of items) {
    assertInScope(scopeWarehouseIds, item.warehouse_id ?? order.warehouseId, '销售单')
  }
  // 查询扫描记录（分仓：覆盖该订单所有仓库任务）
  const orderTaskIds = order.tasks.map(t => t.taskId)
  let scans = []
  if (orderTaskIds.length) {
    const [scanRows] = await pool.query(
      `SELECT task_id, item_id, product_id, barcode, qty, operator_name, scanned_at
       FROM scan_logs WHERE task_id IN (?) ORDER BY scanned_at ASC`,
      [orderTaskIds],
    )
    scans = scanRows
  }
  order.items = items.map(r=>({
    id:r.id,
    productId:r.product_id,
    productCode:r.product_code,
    productName:r.product_name,
    articleNumber:r.article_number||null,
    spec:r.spec||null,
    color:r.color||null,
    unit:r.unit,
    warehouseId: r.warehouse_id != null ? Number(r.warehouse_id) : null,
    warehouseName: r.warehouse_name || null,
    shippedQty: r.shipped_qty != null ? Number(r.shipped_qty) : 0,
    reservedQty: r.reserved_qty != null ? Number(r.reserved_qty) : 0,
    dispatchedQty: r.dispatched_qty != null ? Number(r.dispatched_qty) : 0,
    dispatched: Number(r.dispatched) === 1,
    quantity:Number(r.quantity),
    unitPrice:Number(r.unit_price),
    amount:Number(r.amount),
    entryUnit: r.entry_unit || r.unit,
    entryQty: r.entry_qty != null ? Number(r.entry_qty) : Number(r.quantity),
    conversionRate: Number(r.conversion_rate),
    remark:r.remark,
    costPrice: r.cost_price != null ? Number(r.cost_price) : null,
    belowCost: r.cost_price != null ? Number(r.unit_price) < Number(r.cost_price) : false,
    scans: scansForSaleItem(scans, order.tasks, { productId: r.product_id, warehouseId: r.warehouse_id })
      .map(s => ({
        barcode: s.barcode,
        qty: Number(s.qty),
        operatorName: s.operator_name,
        scannedAt: s.scanned_at,
      })),
  }))
  // 装箱数据（分仓：覆盖该订单所有仓库任务）
  let packages = []
  if (orderTaskIds.length) {
    const [pkgRows] = await pool.query(
      `SELECT id, barcode, status FROM packages WHERE warehouse_task_id IN (?) AND status != 3 ORDER BY id`,
      [orderTaskIds],
    )
    if (pkgRows.length > 0) {
      const pkgIds = pkgRows.map(p => p.id)
      const [itemRows] = await pool.query(
        `SELECT pi.package_id, pi.product_code, pi.product_name, pi.unit, pi.qty, pi.created_at,
                pi.article_number, pi.spec, pi.color
         FROM package_items pi
         WHERE pi.package_id IN (?) ORDER BY pi.id`,
        [pkgIds],
      )
      packages = pkgRows.map(p => ({
        id: p.id,
        barcode: p.barcode,
        status: p.status,
        items: itemRows.filter(i => i.package_id === p.id).map(i => ({
          productCode: i.product_code,
          productName: i.product_name,
          articleNumber: i.article_number || null,
          spec: i.spec || null,
          color: i.color || null,
          unit: i.unit,
          packedAt: i.created_at,
          qty: Number(i.qty),
        })),
      }))
    }
  }
  order.packages = packages
  const [events] = await pool.query(
    `SELECT id,event_type,title,description,payload_json,created_by,created_by_name,created_at
     FROM sale_order_events WHERE sale_order_id=? ORDER BY created_at DESC, id DESC`,
    [id],
  )
  order.timeline = mapTimeline(events, order)
  return order
}

async function create({ customerId, warehouseId, remark,
  carrierId, carrier, freightType, shippingProduct, receiverName, receiverPhone, receiverAddress, items, operator, requestKey, discountAmount, scopeWarehouseIds = null }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'sale.create',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }
    const hydrated = await hydrateSaleInput(conn, { customerId, warehouseId, carrierId, shippingProduct, items, scopeWarehouseIds })
    const customerName = hydrated.customerName
    const warehouseName = hydrated.warehouseName
    carrier = hydrated.carrier
    shippingProduct = hydrated.shippingProduct
    items = hydrated.items
    assertNoDuplicateSaleItemLines(items, warehouseId)
    const orderNo = await genOrderNo(conn)
    const folded = await foldEntryItems(conn, items)   // 多单位折算成基本单位口径（后端权威）
    const total = round2(folded.reduce((s,i)=>s+i.amount,0))
    const discount = Math.max(0, Number(discountAmount) || 0)
    assertDiscountWithinTotal(discount, total)
    const [r] = await conn.query(
      `INSERT INTO sale_orders (order_no,customer_id,customer_name,warehouse_id,warehouse_name,sale_date,total_amount,discount_amount,remark,carrier_id,carrier,freight_type,receiver_name,receiver_phone,receiver_address,shipping_product,operator_id,operator_name) VALUES (?,?,?,?,?,CURDATE(),?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderNo,customerId,customerName,warehouseId,warehouseName,total,discount,remark||null,carrierId||null,carrier||null,freightType||null,receiverName||null,receiverPhone||null,receiverAddress||null,shippingProduct,operator.userId,operator.realName]
    )
    const orderId = r.insertId
    for(const item of folded) {
      // 行级发货仓库：缺省继承订单头仓库（老客户端不传 warehouseId 时即单仓订单）
      const itemWhId = item.warehouseId ? Number(item.warehouseId) : Number(warehouseId)
      const itemWhName = item.warehouseName || warehouseName
      await conn.query(`INSERT INTO sale_order_items (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,entry_unit,article_number,spec,color,quantity,entry_qty,conversion_rate,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[orderId,itemWhId,itemWhName,item.productId,item.productCode,item.productName,item.unit,item.entryUnit,item.articleNumber||null,item.spec||null,item.color||null,item.quantity,item.entryQty,item.conversionRate,item.unitPrice,item.amount,item.remark||null])
    }
    await appendSaleEvent(conn, orderId, 'created', '创建订单', `共 ${items.length} 条明细`, operator)
    await buildPricingEvents(conn, orderId, folded, operator)   // folded：单价已折成每基本单位价，与基本单位进价可比
    const result = { id:orderId, orderNo }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '创建成功',
      resourceType: 'sale_order',
      resourceId: orderId,
    })
    await conn.commit()
    return result
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

// 编辑草稿：仅在 status=1（草稿）时允许，整体替换明细行
async function update(id, { customerId, warehouseId, remark,
  carrierId, carrier, freightType, shippingProduct, receiverName, receiverPhone, receiverAddress, items, operator, scopeWarehouseIds = null, discountAmount }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, columns: 'id, status, warehouse_id', entityName: '销售单' })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '销售单')
    assertStatusAction('sale', 'edit', orderRow.status)
    if (!items || !items.length) throw new AppError('至少需要一条商品明细', 400)
    const hydrated = await hydrateSaleInput(conn, { customerId, warehouseId, carrierId, shippingProduct, items, scopeWarehouseIds })
    const customerName = hydrated.customerName
    const warehouseName = hydrated.warehouseName
    carrier = hydrated.carrier
    shippingProduct = hydrated.shippingProduct
    items = hydrated.items
    assertNoDuplicateSaleItemLines(items, warehouseId)
    const folded = await foldEntryItems(conn, items)   // 多单位折算成基本单位口径（后端权威）
    const total = round2(folded.reduce((s, i) => s + i.amount, 0))
    const discount = Math.max(0, Number(discountAmount) || 0)
    assertDiscountWithinTotal(discount, total)
    const deliverySnapshot = await snapshotItemCommitments(conn, id)
    await conn.query(
      `UPDATE sale_orders SET customer_id=?,customer_name=?,warehouse_id=?,warehouse_name=?,total_amount=?,discount_amount=?,remark=?,carrier_id=?,carrier=?,freight_type=?,receiver_name=?,receiver_phone=?,receiver_address=?,shipping_product=? WHERE id=?`,
      [customerId, customerName, warehouseId, warehouseName, total, discount, remark||null, carrierId||null, carrier||null, freightType||null, receiverName||null, receiverPhone||null, receiverAddress||null, shippingProduct, id]
    )
    await conn.query('DELETE FROM sale_order_items WHERE order_id=?', [id])
    for (const item of folded) {
      const itemWhId = item.warehouseId ? Number(item.warehouseId) : Number(warehouseId)
      const itemWhName = item.warehouseName || warehouseName
      await conn.query(
        `INSERT INTO sale_order_items (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,entry_unit,article_number,spec,color,quantity,entry_qty,conversion_rate,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, itemWhId, itemWhName, item.productId, item.productCode, item.productName, item.unit, item.entryUnit, item.articleNumber||null, item.spec||null, item.color||null, item.quantity, item.entryQty, item.conversionRate, item.unitPrice, item.amount, item.remark||null]
      )
    }
    await restoreItemCommitments(conn, id, deliverySnapshot)
    await appendSaleEvent(conn, id, 'updated', '编辑订单', `现有 ${items.length} 条明细`, operator)
    await buildPricingEvents(conn, id, folded, operator)
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 执行期改单：已占库/拣货中（对应仓库任务在活跃阶段）均可修改明细——增减数量、
// 新增/删除商品行。按 product_id 聚合新旧明细算出净变化，逐 product 委托
// warehouse-tasks.adjust.js 分层处理（增量直接生效补拣；减量视命中深度决定是否需要
// PDA 物理确认）。sale_order_items 本身仍是整表删除重建（同 update() 的模式），
// 因为这是唯一用户可见的"行"，WMS 侧只认按商品聚合后的净数量，详见方案说明。
async function requestAdjustment(id, { items, operator, requestKey, scopeWarehouseIds = null }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: saleOperationAction('adjust', id),
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const orderRow = await lockStatusRow(conn, {
      table: 'sale_orders', id,
      columns: 'id, order_no, status, task_id, task_no, warehouse_id, warehouse_name, customer_id, discount_amount',
      entityName: '销售单',
    })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '销售单')
    assertStatusAction('sale', 'adjust', orderRow.status)
    const hydrated = await hydrateSaleInput(conn, {
      customerId: orderRow.customer_id,
      warehouseId: orderRow.warehouse_id,
      items,
      scopeWarehouseIds,
    })
    items = hydrated.items
    // 分仓/分批锁定边界：多仓订单、或已有任一行发过货的订单，明细一律锁定，不走执行期改单
    // （执行期改单只作用于"单任务"场景，见 warehouse-tasks.adjust.js）。单仓且零出库订单
    // 保持原有改单全流程，行为 100% 不变——这是控制回归风险的红线。
    const [[adjGuard]] = await conn.query(
      `SELECT COUNT(DISTINCT warehouse_id) AS whCount,
              COALESCE(SUM(CASE WHEN shipped_qty > 0 THEN 1 ELSE 0 END), 0) AS shippedAny
       FROM sale_order_items WHERE order_id = ?`,
      [id],
    )
    if (Number(adjGuard.whCount) > 1) {
      throw new AppError('多仓发货的销售单不支持执行期改单，如需调整请用「取消剩余未发」', 400)
    }
    if (Number(adjGuard.shippedAny) > 0) {
      throw new AppError('销售单已部分发货，明细已锁定，只能继续发剩余或取消剩余', 400)
    }
    if (!orderRow.task_id) {
      // 占库期改单：状态 2（已占库）/6（部分占库）尚未发货、无仓库任务，改单不再依赖 WMS 任务联动。
      // 保留已占量：改数量时已占量夹到新数量内；删商品释放其已占；加商品占 0。重建明细后重算状态 2/6。
      return await adjustReservedWithinTransaction(conn, { orderRow, items, operator, requestState })
    }

    const [executionTasks] = await conn.query(
      'SELECT id FROM warehouse_tasks WHERE sale_order_id=? AND deleted_at IS NULL ORDER BY id FOR UPDATE', [id],
    )
    const [[dispatchGuard]] = await conn.query(
      'SELECT COUNT(*) AS incomplete FROM sale_order_items WHERE order_id=? AND (dispatched_qty <> quantity OR reserved_qty <> quantity)', [id],
    )
    if (executionTasks.length !== 1 || Number(executionTasks[0].id) !== Number(orderRow.task_id) || Number(dispatchGuard.incomplete) > 0) {
      throw new AppError('分批派发或多任务订单暂不支持改单，请继续发货或取消剩余未发', 409, 'SALE_ADJUSTMENT_SPLIT_UNSUPPORTED')
    }
    const taskRow = await lockStatusRow(conn, {
      table: 'warehouse_tasks', id: orderRow.task_id,
      columns: 'id, task_no, status, cancel_requested_at, adjustment_requested_at',
      entityName: '仓库任务',
    })
    if (taskRow.cancel_requested_at) throw new AppError('该任务正在拣货退回中，暂不能改单', 409)
    if (taskRow.adjustment_requested_at) throw new AppError('该任务已有改单在等待仓库确认，请先处理完成', 409)
    if (!WT_STATUS_ACTIVE.includes(Number(taskRow.status))) {
      throw new AppError('当前仓库任务状态不支持改单', 400)
    }

    if (!items || !items.length) throw new AppError('至少需要一条商品明细', 400)

    // 重复商品行（同 product+warehouse 两行）会在重建明细时逐行 INSERT、各自独立累加，
    // 占库期分支会让 reserved_qty 合计放大、执行期分支会让 required_qty 失配（与 create/update 同源）。
    assertNoDuplicateSaleItemLines(items, orderRow.warehouse_id)

    // 多单位折算成基本单位口径（后端权威）——**必须在算新旧净变化之前**：录入单位量(箱)若不先折算，
    // 会与旧明细的基本单位量(件)错配，delta 与 WMS 增减量全错。folded 之后一律按基本单位 quantity 算。
    const folded = await foldEntryItems(conn, items)

    const [oldItemRows] = await conn.query(
      'SELECT product_id, quantity, warehouse_id, warehouse_name FROM sale_order_items WHERE order_id=?',
      [id],
    )
    const oldQtyByProduct = new Map()
    for (const r of oldItemRows) {
      const pid = Number(r.product_id)
      oldQtyByProduct.set(pid, (oldQtyByProduct.get(pid) || 0) + Number(r.quantity))
    }
    const newQtyByProduct = new Map()
    const productMeta = new Map()
    for (const item of folded) {
      const pid = Number(item.productId)
      newQtyByProduct.set(pid, (newQtyByProduct.get(pid) || 0) + Number(item.quantity))
      if (!productMeta.has(pid)) {
        productMeta.set(pid, {
          productCode: item.productCode, productName: item.productName, unit: item.unit,
          articleNumber: item.articleNumber || null, spec: item.spec || null, color: item.color || null,
        })
      }
    }

    const total = round2(folded.reduce((s, i) => s + i.amount, 0))
    assertDiscountWithinTotal(orderRow.discount_amount, total)
    await conn.query('UPDATE sale_orders SET total_amount=? WHERE id=?', [total, id])
    const deliverySnapshot = await snapshotItemCommitments(conn, id)
    await conn.query('DELETE FROM sale_order_items WHERE order_id=?', [id])
    // dispatched=1：本分支只在订单已有在跑的仓库任务(orderRow.task_id)时才会走到，
    // 改的是这个已有任务的 required_qty（见 applyProductDeltaWithinTransaction），
    // 不会新建任务——重建出来的明细行本就已被该任务覆盖，不是"待发货"状态，
    // 否则会被 hasUndispatchedItems 误判为还没发货，出现「继续发货」入口重复建任务。
    // 行级发货仓库必须原样带回。自迁移 123 起 sale_order_items.warehouse_id 是
    // shipped_qty 回写、应收重算、出库明细关联三处的唯一定位键；这条 INSERT 漏填后
    // syncShippedByWarehouseTaskWithinTransaction 的 `AND warehouse_id=?` 永远匹配不上
    // （NULL 比较恒不成立）→ shipped_qty 恒为 0 → 订单永远停在履约中(3)、应收恒为 0，
    // 货发出去了却没有账（审计 P0-4）。迁移 126 修过同一条语句漏 dispatched 的问题，
    // 但没发现它同时还漏着仓库字段。
    // 上面的守卫已保证本订单只有一个发货仓库；占库时可能通过 itemOverrides 把行仓库改成
    // 与订单头不同的仓库，所以优先沿用原明细行的仓库，取不到才回退订单头。
    const keptWarehouseId = oldItemRows.find(r => r.warehouse_id != null)?.warehouse_id
      ?? Number(orderRow.warehouse_id)
    const keptWarehouseName = oldItemRows.find(r => r.warehouse_name != null)?.warehouse_name
      ?? orderRow.warehouse_name
    for (const item of folded) {
      await conn.query(
        `INSERT INTO sale_order_items (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,entry_unit,article_number,spec,color,quantity,entry_qty,conversion_rate,unit_price,amount,remark,dispatched,reserved_qty,dispatched_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        [id, keptWarehouseId, keptWarehouseName, item.productId, item.productCode, item.productName, item.unit, item.entryUnit, item.articleNumber||null, item.spec||null, item.color||null, item.quantity, item.entryQty, item.conversionRate, item.unitPrice, item.amount, item.remark||null, item.quantity, item.quantity]
      )
    }

    await restoreItemCommitments(conn, id, deliverySnapshot)

    // 同样按 product_id 升序处理：applyProductDeltaWithinTransaction 内部会锁容器与
    // inventory_stock，Set 的迭代顺序取决于新旧明细的录入次序，并发改单时顺序不一致同样死锁。
    const allProductIds = [...new Set([...oldQtyByProduct.keys(), ...newQtyByProduct.keys()])]
      .sort((a, b) => Number(a) - Number(b))
    const descriptors = []
    for (const pid of allProductIds) {
      const oldQty = oldQtyByProduct.get(pid) || 0
      const newQty = newQtyByProduct.get(pid) || 0
      if (Math.abs(newQty - oldQty) < 1e-6) continue
      let meta = productMeta.get(pid)
      if (!meta) {
        const [[ti]] = await conn.query(
          'SELECT product_code, product_name, unit, article_number, spec, color FROM warehouse_task_items WHERE task_id=? AND product_id=?',
          [orderRow.task_id, pid],
        )
        meta = ti
          ? { productCode: ti.product_code, productName: ti.product_name, unit: ti.unit, articleNumber: ti.article_number, spec: ti.spec, color: ti.color }
          : { productCode: '', productName: `商品#${pid}`, unit: '', articleNumber: null, spec: null, color: null }
      }
      const descriptor = await adjustSvc.applyProductDeltaWithinTransaction(conn, {
        taskId: Number(orderRow.task_id),
        // 行级发货仓库可能≠订单头（占库时经 itemOverrides 改仓）。原始预占(reserveStock)、
        // 仓库任务、收尾释放(checkAdjustmentClearedAndFinalize)都建在行仓库(keptWarehouseId)上，
        // 改单的 reserve/partialReleaseByProduct 必须对齐同一仓库；此前误用订单头仓库会导致
        // 增量预占泄漏到错仓、减量在错仓找不到预占记录而误拒(409)。
        warehouseId: Number(keptWarehouseId),
        saleOrderId: id,
        saleOrderNo: orderRow.order_no,
        productId: pid,
        productCode: meta.productCode,
        productName: meta.productName,
        unit: meta.unit,
        articleNumber: meta.articleNumber || null,
        spec: meta.spec || null,
        color: meta.color || null,
        oldRequiredQty: oldQty,
        newRequiredQty: newQty,
      })
      if (descriptor) descriptors.push(descriptor)
    }

    // 待归还期间实际预占尚未释放，不能提前把已占量改为目标数量。
    await conn.query(
      `UPDATE sale_order_items soi SET reserved_qty = (
         SELECT COALESCE(SUM(sr.qty), 0) FROM stock_reservations sr
         WHERE sr.ref_type='sale_order' AND sr.ref_id=soi.order_id
           AND sr.product_id=soi.product_id AND sr.warehouse_id=soi.warehouse_id AND sr.status=1
       ) WHERE soi.order_id=?`, [id],
    )
    if (!descriptors.length) {
      await appendSaleEvent(conn, id, 'adjusted', '修改明细', '本次修改未涉及数量变化', operator)
      const result = { adjustmentId: null, adjustmentNo: null, pending: false }
      await completeOperationRequest(conn, requestState, {
        data: result, message: '修改成功', resourceType: 'sale_order', resourceId: id,
      })
      await conn.commit()
      return result
    }

    await adjustSvc.finalizeTaskStatusAfterAdjustment(conn, {
      taskId: Number(orderRow.task_id), taskNo: orderRow.task_no, descriptors,
    })

    const needsPending = descriptors.some(d => d.pendingReturnQty > 0 || d.packageVoids.length || d.containerReturns.length)
    let adjustmentId = null
    let adjustmentNo = null
    if (needsPending) {
      adjustmentNo = await generateDailyCode(conn, 'ADJ', 'sale_order_adjustments', 'adjustment_no')
      const [adjRes] = await conn.query(
        `INSERT INTO sale_order_adjustments (sale_order_id, warehouse_task_id, adjustment_no, status, requested_by, requested_by_name)
         VALUES (?,?,?,1,?,?)`,
        [id, orderRow.task_id, adjustmentNo, operator?.userId ?? null, operator?.realName ?? null],
      )
      adjustmentId = adjRes.insertId
      for (const d of descriptors) {
        const hasPending = d.pendingReturnQty > 0 || d.packageVoids.length > 0 || d.containerReturns.length > 0
        const [itemRes] = await conn.query(
          `INSERT INTO sale_order_adjustment_items
             (adjustment_id, product_id, product_code, product_name, old_required_qty, new_required_qty, pending_return_qty, pending_pick_qty, status)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [adjustmentId, d.productId, d.productCode, d.productName, d.oldRequiredQty, d.newRequiredQty,
            d.pendingReturnQty, d.pendingPickQty, hasPending ? 1 : 3],
        )
        const itemId = itemRes.insertId
        for (const v of d.packageVoids) {
          await conn.query(
            `INSERT INTO sale_order_adjustment_package_voids (adjustment_item_id, package_id, barcode, other_products_snapshot)
             VALUES (?,?,?,?)`,
            [itemId, v.packageId, v.barcode, JSON.stringify(v.otherProducts || [])],
          )
        }
        for (const c of d.containerReturns) {
          await conn.query(
            `INSERT INTO sale_order_adjustment_container_returns (adjustment_item_id, source_container_id, original_container_id, qty)
             VALUES (?,?,?,?)`,
            [itemId, c.containerId, c.originalContainerId ?? c.containerId, c.qty],
          )
        }
      }
      await conn.query('UPDATE warehouse_tasks SET adjustment_requested_at=NOW() WHERE id=?', [orderRow.task_id])
      try {
        await recordWtEvent(conn, {
          taskId: Number(orderRow.task_id), taskNo: orderRow.task_no,
          eventType: WT_EVENT.ADJUSTMENT_REQUESTED,
          operatorId: operator?.userId ?? null, operatorName: operator?.realName ?? null,
          detail: { adjustmentId, adjustmentNo, saleOrderId: id, productCount: descriptors.length },
        })
      } catch (eventErr) {
        // 事件写入失败不阻断主流程，仅记录降级日志（与仓库任务模块内其它事件写入保持一致口径）
        require('../warehouse-tasks/warehouse-tasks.helpers').logSideEffectFailure(
          '仓库任务事件写入失败：改单发起事件', eventErr, { taskId: orderRow.task_id, adjustmentId },
        )
      }
    }

    await appendSaleEvent(
      conn, id, 'adjusted', '修改明细',
      needsPending
        ? `已提交改单 ${adjustmentNo}，等待仓库确认后生效`
        : '已修改明细，变更已直接生效',
      operator,
      { adjustmentId, adjustmentNo, productCount: descriptors.length, pending: needsPending },
    )

    const result = { adjustmentId, adjustmentNo, pending: needsPending }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: needsPending ? '改单已提交，等待仓库确认' : '修改成功',
      resourceType: 'sale_order',
      resourceId: id,
    })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 占库期改单（状态 2/6，未发货、无仓库任务）：在已占库存的约束下编辑明细。
//
// 已占量联动规则：
//   - 保留已占量：同名商品改数量时，新已占量 = min(旧已占量, 新数量)，超过部分释放预占；
//   - 删商品：释放该商品全部已占；
//   - 加商品：占 0（改完单后仍需用户去占库弹窗补占）。
// 明细行整体删除重建（同 update() 模式），重建时按 (product, warehouse) 聚合后的数量与
// 已占量对齐；改完重新统计所有行 reserved_qty 是否全满 → 已占库(2)/部分占库(6)。
async function adjustReservedWithinTransaction(conn, { orderRow, items, operator, requestState }) {
  const id = Number(orderRow.id)
  const folded = await foldEntryItems(conn, items)
  if (!folded.length) throw new AppError('至少需要一条商品明细', 400)

  const [oldItemRows] = await conn.query(
    'SELECT * FROM sale_order_items WHERE order_id = ? FOR UPDATE',
    [id],
  )
  // 单仓边界沿用执行期改单口径：占库期改单也只支持单仓（多仓明细锁定，先取消占库再改）
  const whCount = new Set(oldItemRows.map(r => Number(r.warehouse_id))).size
  if (whCount > 1) {
    throw new AppError('多仓发货的销售单不支持占库期改单，如需调整请先取消占库再编辑', 400)
  }

  // 旧已占量按 (product, warehouse) 聚合
  const oldReservedByKey = new Map()
  for (const r of oldItemRows) {
    const key = `${Number(r.product_id)}:${r.warehouse_id != null ? Number(r.warehouse_id) : Number(orderRow.warehouse_id)}`
    oldReservedByKey.set(key, (oldReservedByKey.get(key) || 0) + (Number(r.reserved_qty) || 0))
  }
  // 新数量按 (product, warehouse) 聚合（folded 里 warehouseId 缺省继承订单头）
  const newQtyByKey = new Map()
  for (const item of folded) {
    const whId = item.warehouseId != null ? Number(item.warehouseId) : Number(orderRow.warehouse_id)
    const key = `${Number(item.productId)}:${whId}`
    newQtyByKey.set(key, (newQtyByKey.get(key) || 0) + Number(item.quantity))
  }

  // 计算每个 (product, warehouse) 需要释放的预占差额（旧已占 − 新已占），按 product 排序统一加锁顺序
  const releaseDeltas = []
  for (const [key, oldReserved] of oldReservedByKey) {
    const newQty = newQtyByKey.get(key) || 0
    const keep = Math.min(oldReserved, newQty)
    const release = Math.max(0, oldReserved - keep)
    if (release > 0) releaseDeltas.push({ key, productId: Number(key.split(':')[0]), warehouseId: Number(key.split(':')[1]), release })
  }
  releaseDeltas.sort((a, b) => a.productId - b.productId || a.warehouseId - b.warehouseId)
  for (const d of releaseDeltas) {
    await partialReleaseByProduct(conn, {
      refType: 'sale_order', refId: id,
      productId: d.productId, warehouseId: d.warehouseId, qty: d.release,
    })
  }

  // 重建明细：每行的 reserved_qty = min(旧已占, 新数量)
  const total = round2(folded.reduce((s, i) => s + i.amount, 0))
  assertDiscountWithinTotal(orderRow.discount_amount, total)
  await conn.query('UPDATE sale_orders SET total_amount=? WHERE id=?', [total, id])
  const deliverySnapshot = await snapshotItemCommitments(conn, id)
  await conn.query('DELETE FROM sale_order_items WHERE order_id=?', [id])
  for (const item of folded) {
    const whId = item.warehouseId != null ? Number(item.warehouseId) : Number(orderRow.warehouse_id)
    const whName = item.warehouseName || orderRow.warehouse_name
    const key = `${Number(item.productId)}:${whId}`
    const reservedQty = Math.min(oldReservedByKey.get(key) || 0, Number(item.quantity))
    await conn.query(
      `INSERT INTO sale_order_items (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,entry_unit,article_number,spec,color,quantity,entry_qty,conversion_rate,unit_price,amount,remark,reserved_qty,dispatched_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [id, whId, whName, item.productId, item.productCode, item.productName, item.unit, item.entryUnit, item.articleNumber || null, item.spec || null, item.color || null, item.quantity, item.entryQty, item.conversionRate, item.unitPrice, item.amount, item.remark || null, reservedQty],
    )
  }

  await restoreItemCommitments(conn, id, deliverySnapshot)

  // 重算状态：所有行 reserved_qty >= quantity → 已占库(2)，否则部分占库(6)
  const [[{ unfilled }]] = await conn.query(
    'SELECT COUNT(*) AS unfilled FROM sale_order_items WHERE order_id = ? AND reserved_qty < quantity',
    [id],
  )
  const toStatus = Number(unfilled) === 0 ? SALE_STATUS.RESERVED : SALE_STATUS.PARTIAL_RESERVED
  await compareAndSetStatus(conn, {
    table: 'sale_orders', id,
    fromStatus: Number(orderRow.status), toStatus, entityName: '销售单',
  })

  await appendSaleEvent(conn, id, 'adjusted', '占库期改单',
    `改单完成，已占量按新明细对齐，当前${toStatus === SALE_STATUS.RESERVED ? '已全部占满' : '仍有未占部分'}`, operator)
  await buildPricingEvents(conn, id, folded, operator)

  const result = { adjustmentId: null, adjustmentNo: null, pending: false }
  await completeOperationRequest(conn, requestState, {
    data: result, message: '修改成功', resourceType: 'sale_order', resourceId: id,
  })
  await conn.commit()
  return result
}

// 占库前的分仓预览：按明细行的产品，列出各仓库当前可用量，供占库弹窗逐行选仓库。
async function getReservePreview(id, scopeWarehouseIds = null) {
  const [[orderRow]] = await pool.query(
    'SELECT id, status, warehouse_id, warehouse_name, customer_id, total_amount, discount_amount FROM sale_orders WHERE id = ?', [id],
  )
  if (!orderRow) throw new AppError('销售单不存在', 404)
  assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '销售单')
  assertStatusAction('sale', 'reserve', orderRow.status)
  const [itemRows] = await pool.query('SELECT * FROM sale_order_items WHERE order_id = ? ORDER BY id', [id])
  if (!itemRows.length) throw new AppError('销售单无明细，无法占用库存', 400)

  const productIds = [...new Set(itemRows.map(r => r.product_id))]
  const availability = await getAvailabilityByProducts({ productIds, scopeWarehouseIds, includeExpected: true })
  const availByProduct = new Map()
  for (const a of availability) {
    if (!availByProduct.has(a.productId)) availByProduct.set(a.productId, [])
    availByProduct.get(a.productId).push({
      warehouseId: a.warehouseId, warehouseName: a.warehouseName,
      available: a.available, expected: a.expected, quantity: a.quantity, reserved: a.reserved,
    })
  }

  // 信用预检（文档05：预检是提示不是判定——真正的拦截仍在 reserve 事务内做）。
  // 这里用非事务 pool 查未锁快照，口径与 creditExposure.getCustomerCreditUsed 相同：
  // 未清应收(A) + 在途敞口(B)，排除本单后加回，兼容草稿首次占库及部分占库后的补占。
  let credit = null
  if (orderRow.customer_id) {
    const [[cust]] = await pool.query(
      'SELECT id, credit_limit FROM sale_customers WHERE id=? AND deleted_at IS NULL',
      [orderRow.customer_id],
    )
    if (cust && cust.credit_limit != null) {
      const limit = Number(cust.credit_limit)
      const thisOrder = getNetOrderAmount(orderRow.total_amount, orderRow.discount_amount)
      const used = await getCustomerCreditUsed(pool, orderRow.customer_id, { excludeSaleOrderId: id })
      credit = {
        customerId: Number(orderRow.customer_id),
        creditLimit: limit,
        used,
        thisOrder,
        willExceed: used + thisOrder > limit,
        overAmount: Math.max(0, Math.round((used + thisOrder - limit) * 100) / 100),
      }
    }
  }

  return {
    orderId: orderRow.id,
    warehouseId: Number(orderRow.warehouse_id),
    warehouseName: orderRow.warehouse_name,
    items: itemRows.map(item => ({
      itemId: item.id,
      productId: item.product_id,
      productCode: item.product_code,
      productName: item.product_name,
      articleNumber: item.article_number || null,
      spec: item.spec || null,
      color: item.color || null,
      unit: item.unit,
      quantity: Number(item.quantity),
      reservedQty: item.reserved_qty != null ? Number(item.reserved_qty) : 0,
      remainToReserve: Math.max(0, Number(item.quantity) - (item.reserved_qty != null ? Number(item.reserved_qty) : 0)),
      currentWarehouseId: item.warehouse_id != null ? Number(item.warehouse_id) : Number(orderRow.warehouse_id),
      currentWarehouseName: item.warehouse_name || orderRow.warehouse_name,
      warehouses: (availByProduct.get(item.product_id) || []).sort((a, b) => b.available - a.available),
    })),
    credit,
  }
}

// ① 占用库存：仅调用 reservationEngine.reserve()，不创建仓库任务
//
// 按产品/按数量占库：items 指定「本次占哪些行、每行占多少」（qty 可 < quantity，未传的行不占）。
// 占完后统计是否所有行 reserved_qty >= quantity，全满 → 已占库(2)，否则 → 部分占库(6)。
// 支持从草稿(1)或部分占库(6)重复打开弹窗补占。
//
// items: [{ id, warehouseId, warehouseName, qty }]（qty 为本次要占的数量，>0）
// 先做一次全量可用量检查（不实际预占），把所有不足的商品一次性收集进错误明细。
async function reserveStock(id, operator, items = [], { confirmCreditOverride = false, scopeWarehouseIds = null, requestKey = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: saleOperationAction('reserve', id),
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData ?? null
    }
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '销售单')
    const rule = assertStatusAction('sale', 'reserve', orderRow.status)

    // —— 信用额度校验（在锁库存之前）。客户行 FOR UPDATE 是同客户并发占库的串行化点：
    // 第二个占库事务会在此阻塞，直到第一单 COMMIT 落入在途敞口(B)，再读到的 used 已含第一单。
    // 授信是「订单级」额度，按整单 total_amount 校验，不因本次只占部分货而打折。
    const [[cust]] = await conn.query(
      'SELECT id, credit_limit FROM sale_customers WHERE id = ? FOR UPDATE',
      [orderRow.customer_id],
    )
    if (cust && cust.credit_limit != null) {
      const used = await getCustomerCreditUsed(conn, orderRow.customer_id, { excludeSaleOrderId: id }) // 补占时本单已计入敞口，先排除再加回
      const thisOrder = getNetOrderAmount(orderRow.total_amount, orderRow.discount_amount)
      const limit = Number(cust.credit_limit)
      if (used + thisOrder > limit) {
        const overBy = Math.round((used + thisOrder - limit) * 100) / 100
        const approvedOverrideId = await creditOverrideSvc.hasApprovedOverride(id, {
          conn,
          customerId: orderRow.customer_id,
          creditLimit: limit,
          thisAmount: thisOrder,
          overAmount: overBy,
        })
        const allowOverride = approvedOverrideId != null || (confirmCreditOverride && await hasCreditOverridePermission(conn, operator))
        if (!allowOverride) {
          throw new AppError('客户授信额度不足', 409, 'CREDIT_LIMIT_EXCEEDED', { creditLimit: limit, used, thisOrder, overBy })
        }
        const via = approvedOverrideId != null
          ? `已批准放行申请单 CO#${approvedOverrideId} 自动放行`
          : '一次性授权放行'
        await appendSaleEvent(conn, id, 'credit_override', '超额授信放行',
          `额度 ${limit}，已用 ${used}，本单 ${thisOrder}，超出 ${overBy}，${via}`, operator,
          { creditLimit: limit, used, thisOrder, overBy, via: approvedOverrideId != null ? 'approved_override' : 'manual_override', approvedOverrideId })
      }
    }

    // 按 items 里的 id 精确取本次要占的明细行，并用 items 里的 qty/仓库覆盖
    const [allItemRows] = await conn.query('SELECT * FROM sale_order_items WHERE order_id = ? ORDER BY id', [id])
    if (!allItemRows.length) throw new AppError('销售单无明细，无法占用库存', 400)
    const itemById = new Map(allItemRows.map(r => [Number(r.id), r]))
    // 向后兼容：不传 items（旧客户端/测试）＝占满所有未占余量（等价于旧的整单占库）
    const effectiveItems = items.length
      ? items
      : allItemRows.map(r => ({ id: r.id, qty: Math.max(0, Number(r.quantity) - (Number(r.reserved_qty) || 0)) }))
    const reserveItems = []
    // 同一明细行在 items 里出现多次时，逐项累计已占量，防止重复 id 绕过「占库量≤未占余量」校验超占
    const processedById = new Map()
    for (const it of effectiveItems) {
      const row = itemById.get(Number(it.id))
      if (!row) throw new AppError(`明细行 ${it.id} 不存在`, 400)
      const qty = Number(it.qty)
      if (!(qty > 0)) continue   // 本次不占该行
      const processed = processedById.get(Number(it.id)) || 0
      const already = (Number(row.reserved_qty) || 0) + processed
      const remain = Number(row.quantity) - already
      if (qty > remain + 1e-6) {
        throw new AppError(`商品「${row.product_name}」本次占库量 ${qty} 超过未占余量 ${remain}`, 400)
      }
      processedById.set(Number(it.id), processed + qty)
      const whId = it.warehouseId != null ? Number(it.warehouseId)
        : (row.warehouse_id != null ? Number(row.warehouse_id) : Number(orderRow.warehouse_id))
      assertInScope(scopeWarehouseIds, whId, '销售单')
      reserveItems.push({ ...row, reserveQty: qty, warehouseId: whId })
    }
    if (!reserveItems.length) throw new AppError('本次没有有效的占库数量', 400)

    const reserveWarehouseIds = [...new Set(reserveItems.map(item => Number(item.warehouseId)))]
    const [reserveWarehouses] = await conn.query(
      'SELECT id, name, is_active FROM inventory_warehouses WHERE id IN (?) AND deleted_at IS NULL',
      [reserveWarehouseIds],
    )
    const reserveWarehouseById = new Map(reserveWarehouses.map(row => [Number(row.id), row]))
    for (const item of reserveItems) {
      const warehouse = reserveWarehouseById.get(Number(item.warehouseId))
      if (!warehouse) throw new AppError(`仓库 ${item.warehouseId} 不存在`, 404)
      if (!warehouse.is_active) throw new AppError(`仓库「${warehouse.name}」已停用，无法占库`, 400)
      item.warehouseName = warehouse.name
    }

    // 写回每行仓库（分仓发货：占库时选定发货仓库）
    for (const it of reserveItems) {
      await conn.query(
        'UPDATE sale_order_items SET warehouse_id = ?, warehouse_name = ? WHERE id = ? AND order_id = ?',
        [it.warehouseId, it.warehouseName, it.id, id],
      )
    }

    // 可用量按本次要占的数量检查（分仓订单不同行可能在不同仓库）。
    // includeExpected：把「已提交采购单预计到货量」算进可用（ATP）。仅销售占库走此口径。
    const itemWh = it => Number(it.warehouseId)
    const uniqPairs = [...new Map(reserveItems.map(it => [`${Number(it.product_id)}:${itemWh(it)}`, it])).values()]
    const availMap = new Map()
    // 一次锁定全部采购供应，再按统一维度顺序锁现货；后续每行 reserve 重新分配绑定。
    await lockExpectedPurchaseOrders(conn, uniqPairs.map(p => ({ productId: p.product_id, warehouseId: itemWh(p) })))
    const sortedPairs = [...uniqPairs].sort((a, b) => Number(a.product_id) - Number(b.product_id) || itemWh(a) - itemWh(b))
    for (const p of sortedPairs) {
      const projection = await getStockProjection(conn, { productId: p.product_id, warehouseId: itemWh(p), lock: true, includeExpected: true })
      availMap.set(`${Number(p.product_id)}:${itemWh(p)}`, projection.available)
    }
    const shortages = []
    for (const it of reserveItems) {
      const key = `${Number(it.product_id)}:${itemWh(it)}`
      const available = availMap.get(key) ?? 0
      availMap.set(key, Math.max(0, available - Number(it.reserveQty)))
      if (available < Number(it.reserveQty)) {
        shortages.push({
          productId: it.product_id,
          productName: it.product_name,
          warehouseName: it.warehouseName,
          required: Number(it.reserveQty),
          available,
        })
      }
    }
    if (shortages.length) {
      throw new AppError(
        `以下商品可用库存不足，共 ${shortages.length} 项：` +
        shortages.map(s => `${s.productName}（${s.warehouseName}｜需 ${s.required}，可用 ${s.available}）`).join('；'),
        400,
        'STOCK_SHORTAGE',
        { shortages },
      )
    }

    // 按 (product_id, warehouse_id) 排序后逐行预占，统一加锁顺序防死锁（审计 P1-6）。
    const reserveOrder = [...reserveItems].sort(
      (a, b) => Number(a.product_id) - Number(b.product_id) || itemWh(a) - itemWh(b),
    )
    for (const item of reserveOrder) {
      await reserve(conn, {
        productId:   item.product_id,
        productName: item.product_name,
        warehouseId: itemWh(item),
        qty:         Number(item.reserveQty),
        refType:     'sale_order',
        refId:       Number(orderRow.id),
        refItemId:   Number(item.id),
        refNo:       orderRow.order_no,
        includeExpected: true,
      })
      await conn.query(
        'UPDATE sale_order_items SET reserved_qty = reserved_qty + ? WHERE id = ?',
        [Number(item.reserveQty), item.id],
      )
    }

    // 占完后统计：所有行 reserved_qty >= quantity → 已占库(2)，否则部分占库(6)
    const [[{ unfilled }]] = await conn.query(
      'SELECT COUNT(*) AS unfilled FROM sale_order_items WHERE order_id = ? AND reserved_qty < quantity',
      [id],
    )
    const toStatus = Number(unfilled) === 0 ? SALE_STATUS.RESERVED : SALE_STATUS.PARTIAL_RESERVED
    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus,
      entityName: '销售单',
    })
    const wasPartial = Number(orderRow.status) === SALE_STATUS.PARTIAL_RESERVED
    const nowFull = toStatus === SALE_STATUS.RESERVED
    await appendSaleEvent(conn, id, 'reserved',
      nowFull ? (wasPartial ? '补占完成' : '确认占库') : (wasPartial ? '补充占库' : '部分占库'),
      nowFull
        ? (wasPartial ? `补占后已全部占满` : `已预占全部库存`)
        : `本次预占 ${reserveItems.length} 行，仍有未占部分`,
      operator,
      { reserveCount: reserveItems.length, fullReserved: nowFull })
    await completeOperationRequest(conn, requestState, {
      data: null,
      message: nowFull ? (wasPartial ? '补占完成' : '确认占库') : (wasPartial ? '补充占库' : '部分占库'),
      resourceType: 'sale_order',
      resourceId: id,
    })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ② 发起出库：按明细行的发货仓库分组，每个仓库创建一个仓库任务，不扣减库存，
// 订单进入拣货中（status=3）。单仓订单 = 只有一组 = 一个任务（与旧行为一致）。
// sale_orders.task_id/task_no 记录"最近创建的任务"（兼容旧字段，主查询走 sale_order_id 反查）。
//
// 发货量不能超过「已占未发」差额；传 items 时按行按量分批，不传时发完全部差额。
// 建完任务按实际请求量累加 dispatched_qty。首次发货 2/6→3；继续发剩余保持 3。
async function ship(id, operator, { itemIds = null, items = null, scopeWarehouseIds = null, requestKey = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: saleOperationAction('ship', id),
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData ?? null
    }
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '销售单')
    const curStatus = Number(orderRow.status)
    // 允许从「已占库(2)/部分占库(6)」首次发货，或「履约中(3)」继续发剩余；其它状态走标准报错
    if (curStatus !== SALE_STATUS.RESERVED && curStatus !== SALE_STATUS.PARTIAL_RESERVED && curStatus !== SALE_STATUS.PICKING) {
      assertStatusAction('sale', 'ship', orderRow.status)
    }

    // 取「已占未发完」的行，再按新 items 或兼容的旧 itemIds 契约选择本批数量。
    let [itemRows] = await conn.query(
      'SELECT * FROM sale_order_items WHERE order_id = ? AND dispatched_qty < reserved_qty ORDER BY id',
      [id],
    )
    if (!itemRows.length) throw new AppError('该销售单已无可发货明细，请先占库', 400)
    itemRows = selectDispatchRows(itemRows, { items, itemIds })

    // 按发货仓库分组（缺省行仓库=订单头）；每行本次发货量 = 已占 - 已派发
    const groups = new Map()
    for (const r of itemRows) {
      const whId = r.warehouse_id != null ? Number(r.warehouse_id) : Number(orderRow.warehouse_id)
      const whName = r.warehouse_name || orderRow.warehouse_name
      assertInScope(scopeWarehouseIds, whId, '销售单')
      const shipQty = r.requested_ship_qty ?? (Number(r.reserved_qty) - Number(r.dispatched_qty))
      if (!groups.has(whId)) groups.set(whId, { warehouseId: whId, warehouseName: whName, items: [] })
      groups.get(whId).items.push({
        id: r.id,
        productId: r.product_id,
        productCode: r.product_code,
        productName: r.product_name,
        unit: r.unit,
        articleNumber: r.article_number || null,
        spec: r.spec || null,
        color: r.color || null,
        quantity: shipQty,
      })
    }

    const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
    const created = []
    for (const grp of groups.values()) {
      const { taskId, taskNo } = await taskSvc.createForSaleOrder({
        saleOrderId:   Number(orderRow.id),
        saleOrderNo:   orderRow.order_no,
        customerId:    Number(orderRow.customer_id),
        customerName:  orderRow.customer_name,
        warehouseId:   grp.warehouseId,
        warehouseName: grp.warehouseName,
        items:         grp.items,
        conn,
      })
      created.push({ taskId, taskNo, warehouseName: grp.warehouseName })
    }
    // 标记本次已派发：按实际请求量累加，支持同一明细分多次创建任务。
    for (const r of itemRows) {
      const dispatchedQty = r.requested_ship_qty ?? (Number(r.reserved_qty) - Number(r.dispatched_qty))
      await conn.query(
        'UPDATE sale_order_items SET dispatched_qty = dispatched_qty + ? WHERE id = ?',
        [dispatchedQty, r.id],
      )
    }

    const last = created[created.length - 1]
    if (curStatus !== SALE_STATUS.PICKING) {
      // 首次发货：已占库(2)/部分占库(6) → 履约中(3)
      const rule = assertStatusAction('sale', 'ship', orderRow.status)
      await compareAndSetStatus(conn, {
        table: 'sale_orders', id,
        fromStatus: rule.from, toStatus: rule.to, entityName: '销售单',
        extraSet: { task_id: last.taskId, task_no: last.taskNo },
      })
    } else {
      // 继续发剩余行：订单已在履约中(3)，只更新最近任务字段
      await conn.query('UPDATE sale_orders SET task_id = ?, task_no = ? WHERE id = ?', [last.taskId, last.taskNo, id])
    }

    // 是否还有「已占未发」的行（用于事件描述与前端「继续发货」入口判断）
    const [[{ remaining }]] = await conn.query(
      'SELECT COUNT(*) AS remaining FROM sale_order_items WHERE order_id = ? AND dispatched_qty < reserved_qty',
      [id],
    )
    const partial = Number(remaining) > 0
    await appendSaleEvent(
      conn, id, 'ship_requested', partial ? '发起出库（部分）' : '发起出库',
      partial
        ? `本次对 ${itemRows.length} 条明细发起出库，还有 ${remaining} 条未发`
        : (created.length > 1 ? `已按 ${created.length} 个仓库分别创建出库任务` : `已创建仓库任务，等待拣货`),
      operator,
      { tasks: created, partial, remaining: Number(remaining) },
    )
    await completeOperationRequest(conn, requestState, {
      data: { tasks: created, partial, remaining: Number(remaining) },
      message: partial ? '已发起部分出库' : '出库任务已创建，等待仓库操作',
      resourceType: 'sale_order',
      resourceId: id,
    })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 取消占库：按产品/数量释放（items 传 [{id, qty}]）或整单释放（items 为 null）。
// 释放后统计：全部行 reserved_qty=0 → 草稿(1)；仍有部分 → 部分占库(6)。
async function releaseStock(id, operator, items = null, scopeWarehouseIds = null, requestKey = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: saleOperationAction('release', id),
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData ?? null
    }
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '销售单')
    const rule = assertStatusAction('sale', 'release', orderRow.status)

    if (Array.isArray(items) && items.length) {
      // 按产品/数量释放：先锁明细行，逐行 partialReleaseByProduct，回写 reserved_qty
      const [itemRows] = await conn.query('SELECT * FROM sale_order_items WHERE order_id = ? FOR UPDATE', [id])
      for (const row of itemRows) {
        assertInScope(scopeWarehouseIds, row.warehouse_id ?? orderRow.warehouse_id, '销售单')
      }
      const itemById = new Map(itemRows.map(r => [Number(r.id), r]))
      // 同一明细行在 items 里出现多次时，逐项累计已释放量，防止重复 id 绕过「释放量≤已占量」校验超释
      const processedById = new Map()
      for (const it of items) {
        const row = itemById.get(Number(it.id))
        if (!row) throw new AppError(`明细行 ${it.id} 不存在`, 400)
        const qty = Number(it.qty)
        if (!(qty > 0)) continue
        const processed = processedById.get(Number(it.id)) || 0
        const already = (Number(row.reserved_qty) || 0) - processed
        if (qty > already + 1e-6) {
          throw new AppError(`商品「${row.product_name}」释放数量 ${qty} 超过已占量 ${already}`, 400)
        }
        processedById.set(Number(it.id), processed + qty)
        const whId = row.warehouse_id != null ? Number(row.warehouse_id) : Number(orderRow.warehouse_id)
        await partialReleaseByProduct(conn, {
          refType: 'sale_order', refId: Number(orderRow.id),
          productId: row.product_id, warehouseId: whId, qty,
        })
        await conn.query(
          'UPDATE sale_order_items SET reserved_qty = reserved_qty - ? WHERE id = ?',
          [qty, row.id],
        )
      }
      const [[{ remaining }]] = await conn.query(
        'SELECT COALESCE(SUM(reserved_qty), 0) AS remaining FROM sale_order_items WHERE order_id = ?',
        [id],
      )
      const toStatus = Number(remaining) === 0 ? SALE_STATUS.DRAFT : SALE_STATUS.PARTIAL_RESERVED
      await compareAndSetStatus(conn, {
        table: 'sale_orders', id,
        fromStatus: rule.from, toStatus, entityName: '销售单',
      })
      await appendSaleEvent(conn, id, 'released',
        toStatus === SALE_STATUS.DRAFT ? '取消占库' : '部分取消占库',
        toStatus === SALE_STATUS.DRAFT ? `销售单 ${orderRow.order_no} 已取消占库并恢复草稿` : `销售单 ${orderRow.order_no} 已释放部分预占`,
        operator)
    } else {
      // 整单释放
      const [scopeRows] = await conn.query('SELECT warehouse_id FROM sale_order_items WHERE order_id = ? FOR UPDATE', [id])
      for (const row of scopeRows) assertInScope(scopeWarehouseIds, row.warehouse_id ?? orderRow.warehouse_id, '销售单')
      await releaseByRef(conn, 'sale_order', id)
      await conn.query('UPDATE sale_order_items SET reserved_qty = 0 WHERE order_id = ?', [id])
      await compareAndSetStatus(conn, {
        table: 'sale_orders', id,
        fromStatus: rule.from, toStatus: SALE_STATUS.DRAFT, entityName: '销售单',
      })
      await appendSaleEvent(conn, id, 'released', '取消占库', `销售单 ${orderRow.order_no} 已取消占库并恢复草稿`, operator)
    }
    await completeOperationRequest(conn, requestState, {
      data: null,
      message: '已释放预占库存',
      resourceType: 'sale_order',
      resourceId: id,
    })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 取消订单：仅 DRAFT(1) → CANCELLED(5)
async function cancel(id, operator, scopeWarehouseIds = null, requestKey = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: saleOperationAction('cancel', id),
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData ?? null
    }
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '销售单')
    const rule = assertStatusAction('sale', 'cancel', orderRow.status)

    if (Number(orderRow.status) === 2 || Number(orderRow.status) === 6) {
      const [scopeRows] = await conn.query('SELECT warehouse_id FROM sale_order_items WHERE order_id = ? FOR UPDATE', [id])
      for (const row of scopeRows) assertInScope(scopeWarehouseIds, row.warehouse_id ?? orderRow.warehouse_id, '销售单')
      await releaseByRef(conn, 'sale_order', id)
      await conn.query('UPDATE sale_order_items SET reserved_qty = 0 WHERE order_id = ?', [id])
    }

    if (Number(orderRow.status) === 3) {
      const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
      // 分仓：一个订单可能有多个仓库任务。遍历所有关联任务——已出库(7)的不能取消（货已发出），
      // 其余活跃任务逐个取消（taskSvc.cancel 内部走逆向归还判断，并释放该订单未履行的预占）。
      const [tasks] = await conn.query(
        'SELECT id, status, warehouse_id FROM warehouse_tasks WHERE sale_order_id = ? AND deleted_at IS NULL',
        [id],
      )
      for (const task of tasks) assertInScope(scopeWarehouseIds, task.warehouse_id, '销售单')
      const activeTasks = tasks.filter(t => ![7, 8].includes(Number(t.status)))
      const shippedTasks = tasks.filter(t => Number(t.status) === 7)
      if (!tasks.length) {
        throw new AppError('销售单处于拣货中但未关联仓库任务，请先排查异常', 409)
      }
      for (const t of activeTasks) {
        await taskSvc.cancel(t.id, { conn, syncSaleStatus: false, operator })
      }
      // 分批：未派发行（dispatched=0，没有任务）的预占不会被 taskSvc.cancel 释放；
      // 且若活跃任务为空（如唯一任务已出库、剩余全是未派发行），上面循环根本不释放预占。
      // 这里兜底整单释放剩余 active 预占（releaseByRef 幂等，已释放的不受影响）。
      await releaseByRef(conn, 'sale_order', id)
      // 部分已发：有货已经发出，不能整单取消，改为按实发精简明细——未发过的行整行删除，
      // 发了一部分的行把数量降到实发量，这样订单里剩下的每一行都是"要求数量=实发数量"，
      // 状态就能老老实实显示"已出库"，不需要再挂一个"部分发货"的特殊标记。
      // 原始要求数量记录进事件里，供事后追溯本单原本要发多少。
      if (shippedTasks.length > 0) {
        const originalTotal = Number(orderRow.total_amount) || 0
        const originalDiscount = Number(orderRow.discount_amount) || 0
        const [itemRows] = await conn.query(
          'SELECT id, product_id, product_name, quantity, shipped_qty, unit_price FROM sale_order_items WHERE order_id = ? FOR UPDATE',
          [id],
        )
        const removed = []
        const trimmed = []
        const deleteIds = []
        for (const item of itemRows) {
          const shipped = Number(item.shipped_qty)
          const qty = Number(item.quantity)
          if (shipped <= 0) {
            deleteIds.push(item.id)
            removed.push({ productId: item.product_id, productName: item.product_name, quantity: qty })
          } else if (shipped < qty) {
            await conn.query(
              'UPDATE sale_order_items SET quantity = ?, amount = ?, reserved_qty = ?, dispatched_qty = ? WHERE id = ?',
              [shipped, shipped * Number(item.unit_price), shipped, shipped, item.id],
            )
            trimmed.push({ productId: item.product_id, productName: item.product_name, fromQuantity: qty, toQuantity: shipped })
          }
        }
        if (deleteIds.length) {
          await conn.query('DELETE FROM sale_order_items WHERE id IN (?)', [deleteIds])
        }
        const [[{ total }]] = await conn.query(
          'SELECT COALESCE(SUM(amount), 0) AS total FROM sale_order_items WHERE order_id = ?',
          [id],
        )
        const closedDiscount = calculateDiscountApplied({
          discount: originalDiscount,
          shippedGross: Number(total),
          orderGross: originalTotal,
        })
        await conn.query(
          'UPDATE sale_orders SET total_amount = ?, discount_amount = ? WHERE id = ?',
          [total, closedDiscount, id],
        )
        await recomputeSaleReceivable(conn, id)

        await compareAndSetStatus(conn, {
          table: 'sale_orders', id,
          fromStatus: [3], toStatus: 4, entityName: '销售单',
        })
        await appendSaleEvent(
          conn, id, 'partial_ship_closed', '关闭剩余未发',
          `销售单 ${orderRow.order_no} 已发部分保留，未发商品已从明细中移除，按实发结案`,
          operator,
          { removed, trimmed },
        )
        await completeOperationRequest(conn, requestState, {
          data: null, message: '已关闭剩余未发', resourceType: 'sale_order', resourceId: id,
        })
        await conn.commit()
        return
      }
    }

    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
    })
    await appendSaleEvent(conn, id, 'cancelled', '取消订单', `销售单已取消`, operator)
    await completeOperationRequest(conn, requestState, {
      data: null, message: '已取消', resourceType: 'sale_order', resourceId: id,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// 删除订单：仅 CANCELLED(5) 可删
async function deleteOrder(id, operator, scopeWarehouseIds = null, requestKey = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: saleOperationAction('delete', id),
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData ?? null
    }
    // 在事务内读取并锁定订单行，防止并发状态变更
    const [[order]] = await conn.query(
      'SELECT id, status, order_no, warehouse_id FROM sale_orders WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [id],
    )
    if (!order) throw new AppError('订单不存在', 404)
    assertInScope(scopeWarehouseIds, order.warehouse_id, '销售单')
    assertStatusAction('sale', 'delete', order.status)
    const [scopeRows] = await conn.query('SELECT warehouse_id FROM sale_order_items WHERE order_id = ? FOR UPDATE', [id])
    for (const row of scopeRows) assertInScope(scopeWarehouseIds, row.warehouse_id ?? order.warehouse_id, '销售单')
    await conn.query('UPDATE sale_orders SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id])
    await completeOperationRequest(conn, requestState, {
      data: null, message: '订单删除成功', resourceType: 'sale_order', resourceId: id,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  requestAdjustment,
  getReservePreview,
  reserveStock,
  releaseStock,
  ship,
  cancel,
  deleteOrder,
  syncPickingByWarehouseTaskWithinTransaction,
  syncShippedByWarehouseTaskWithinTransaction,
  syncCancelledByWarehouseTaskWithinTransaction,
}
