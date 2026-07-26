const { pool } = require('../../config/db')
const { scopeFilter } = require('../../utils/warehouseScope')
const AppError = require('../../utils/AppError')
const { reserve, releaseByRef } = require('../../engine/reservationEngine')
const { getAvailableStockForDecision } = require('../../engine/containerEngine')
const { getAvailabilityByProducts } = require('../inventory/inventory.service')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { SALE_STATUS_NAME } = require('../../constants/saleOrderStatus')
const { buildDueDateSql, normalizeSettlementType } = require('../../constants/settlementType')
const { WT_STATUS_NAME, WT_STATUS_ACTIVE } = require('../../constants/warehouseTaskStatus')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const adjustSvc = require('../warehouse-tasks/warehouse-tasks.adjust')
const { WT_EVENT, record: recordWtEvent } = require('../warehouse-tasks/warehouse-task-events.service')

const FREIGHT_TYPE = { 1:'寄付', 2:'到付', 3:'第三方付' }
const fmt = row => ({
  id:row.id, orderNo:row.order_no,
  customerId:row.customer_id, customerName:row.customer_name,
  warehouseId:row.warehouse_id, warehouseName:row.warehouse_name,
  status:row.status, statusName:SALE_STATUS_NAME[row.status],
  saleDate:row.sale_date, totalAmount:Number(row.total_amount), remark:row.remark,
  taskId:row.warehouse_task_id||row.task_id||null,
  taskNo:row.warehouse_task_no||row.task_no||null,
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
  receivableOverdue: row.receivable_status != null && Number(row.receivable_status) !== 3
    && row.receivable_due_date != null && new Date(row.receivable_due_date).getTime() < Date.now(),
  carrierId:row.carrier_id||null,
  carrier: row.carrier_name || row.carrier || null,   // 优先承运商表名称，回退文本字段
  freightType:row.freight_type||null,
  freightTypeName:row.freight_type ? (FREIGHT_TYPE[row.freight_type]||null) : null,
  receiverName:row.receiver_name||null, receiverPhone:row.receiver_phone||null,
  receiverAddress:row.receiver_address||null,
  operatorId:row.operator_id, operatorName:row.operator_name, createdAt:row.created_at,
})

// 一个销售单终生最多对应一个仓库任务：ship() 用 sale_orders.task_id 是否已置位来防止重复创建
// （见 ship() 里 `if (orderRow.task_id) throw ...`），且 createForSaleOrder 是唯一会写
// warehouse_tasks.sale_order_id 的地方、只被 ship() 调用一次。所以直接按 so.task_id 主键点查
// 即可拿到对应仓库任务，不需要再对整张 warehouse_tasks 表做 MAX(id) GROUP BY 聚合。
const latestWarehouseTaskJoin = `
  LEFT JOIN warehouse_tasks wt_by_id ON wt_by_id.id = so.task_id AND wt_by_id.deleted_at IS NULL
`

const warehouseTaskProjection = `
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
           SUM(CASE WHEN dispatched = 0 THEN 1 ELSE 0 END) AS undispatched_count
    FROM sale_order_items GROUP BY order_id
  ) soi_agg ON soi_agg.order_id = so.id
`
const itemAggProjection = `
  soi_agg.ordered_total_qty, soi_agg.shipped_total_qty, soi_agg.warehouse_count,
  soi_agg.undispatched_count
`

// 回款信息（不改订单状态机，独立于订单状态展示）：payment_records type=2（应收）
const paymentJoin = `
  LEFT JOIN payment_records pr_recv ON pr_recv.type = 2 AND pr_recv.order_id = so.id
`
const paymentProjection = `
  pr_recv.status AS receivable_status, pr_recv.due_date AS receivable_due_date,
  pr_recv.balance AS receivable_balance
`
const RECEIVABLE_STATUS_NAME = { 1: '未付', 2: '部分付', 3: '已付清' }

const genOrderNo = conn => generateDailyCode(conn, 'SO', 'sale_orders', 'order_no')

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
  const total = Number(amount) || 0
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
       balance = VALUES(total_amount) - paid_amount,
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

async function findAll({ page=1, pageSize=20, keyword='', status=null, productId=null, customerId=null, warehouseId=null, startDate=null, endDate=null, remark=null, operatorId=null, scopeWarehouseIds=null }) {
  const offset=(page-1)*pageSize
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
  if (status) {
    cond += ' AND so.status=?'
    countCond += ' AND status=?'
    params.push(status)
    countParams.push(status)
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
    cond += ' AND DATE(so.created_at)>=?'
    countCond += ' AND DATE(created_at)>=?'
    params.push(startDate)
    countParams.push(startDate)
  }
  if (endDate) {
    cond += ' AND DATE(so.created_at)<=?'
    countCond += ' AND DATE(created_at)<=?'
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
  const [rows] = await pool.query(
    `SELECT so.*, ${warehouseTaskProjection}, ${itemAggProjection}, ${paymentProjection}
     FROM sale_orders so
     ${latestWarehouseTaskJoin}
     ${itemAggJoin}
     ${paymentJoin}
     WHERE so.deleted_at IS NULL ${cond}
     ORDER BY so.created_at DESC LIMIT ? OFFSET ?`,
    [...params,pageSize,offset],
  )
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_orders WHERE deleted_at IS NULL ${countCond}`,countParams)
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
}

async function findById(id) {
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
  const order = fmt(rows[0])

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
  // 查询扫描记录（分仓：覆盖该订单所有仓库任务）
  const orderTaskIds = order.tasks.map(t => t.taskId)
  let scans = []
  if (orderTaskIds.length) {
    const [scanRows] = await pool.query(
      `SELECT item_id, product_id, barcode, qty, operator_name, scanned_at
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
    dispatched: Number(r.dispatched) === 1,
    quantity:Number(r.quantity),
    unitPrice:Number(r.unit_price),
    amount:Number(r.amount),
    remark:r.remark,
    costPrice: r.cost_price != null ? Number(r.cost_price) : null,
    belowCost: r.cost_price != null ? Number(r.unit_price) < Number(r.cost_price) : false,
    scans: scans
      .filter(s => s.product_id === r.product_id)
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

async function create({ customerId, customerName, warehouseId, warehouseName, remark,
  carrierId, carrier, freightType, receiverName, receiverPhone, receiverAddress, items, operator, requestKey }) {
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
    // 前端选择器已过滤停用客户，这里补一道后端校验，防止绕过前端直接调 API 建单（禁用客户未在下单流程过滤）
    const [[customerRow]] = await conn.query(
      'SELECT is_active FROM sale_customers WHERE id = ? AND deleted_at IS NULL',
      [customerId],
    )
    if (!customerRow) throw new AppError('客户不存在', 404)
    if (!customerRow.is_active) throw new AppError('该客户已停用，无法新建销售单', 400)
    const orderNo = await genOrderNo(conn)
    const total = items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r] = await conn.query(
      `INSERT INTO sale_orders (order_no,customer_id,customer_name,warehouse_id,warehouse_name,sale_date,total_amount,remark,carrier_id,carrier,freight_type,receiver_name,receiver_phone,receiver_address,operator_id,operator_name) VALUES (?,?,?,?,?,CURDATE(),?,?,?,?,?,?,?,?,?,?)`,
      [orderNo,customerId,customerName,warehouseId,warehouseName,total,remark||null,carrierId||null,carrier||null,freightType||null,receiverName||null,receiverPhone||null,receiverAddress||null,operator.userId,operator.realName]
    )
    const orderId = r.insertId
    for(const item of items) {
      // 行级发货仓库：缺省继承订单头仓库（老客户端不传 warehouseId 时即单仓订单）
      const itemWhId = item.warehouseId ? Number(item.warehouseId) : Number(warehouseId)
      const itemWhName = item.warehouseName || warehouseName
      await conn.query(`INSERT INTO sale_order_items (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[orderId,itemWhId,itemWhName,item.productId,item.productCode,item.productName,item.unit,item.articleNumber||null,item.spec||null,item.color||null,item.quantity,item.unitPrice,item.quantity*item.unitPrice,item.remark||null])
    }
    await appendSaleEvent(conn, orderId, 'created', '创建订单', `共 ${items.length} 条明细`, operator)
    await buildPricingEvents(conn, orderId, items, operator)
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
async function update(id, { customerId, customerName, warehouseId, warehouseName, remark,
  carrierId, carrier, freightType, receiverName, receiverPhone, receiverAddress, items, operator }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, columns: 'id, status', entityName: '销售单' })
    assertStatusAction('sale', 'edit', orderRow.status)
    if (!items || !items.length) throw new AppError('至少需要一条商品明细', 400)
    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    await conn.query(
      `UPDATE sale_orders SET customer_id=?,customer_name=?,warehouse_id=?,warehouse_name=?,total_amount=?,remark=?,carrier_id=?,carrier=?,freight_type=?,receiver_name=?,receiver_phone=?,receiver_address=? WHERE id=?`,
      [customerId, customerName, warehouseId, warehouseName, total, remark||null, carrierId||null, carrier||null, freightType||null, receiverName||null, receiverPhone||null, receiverAddress||null, id]
    )
    await conn.query('DELETE FROM sale_order_items WHERE order_id=?', [id])
    for (const item of items) {
      const itemWhId = item.warehouseId ? Number(item.warehouseId) : Number(warehouseId)
      const itemWhName = item.warehouseName || warehouseName
      await conn.query(
        `INSERT INTO sale_order_items (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, itemWhId, itemWhName, item.productId, item.productCode, item.productName, item.unit, item.articleNumber||null, item.spec||null, item.color||null, item.quantity, item.unitPrice, item.quantity*item.unitPrice, item.remark||null]
      )
    }
    await appendSaleEvent(conn, id, 'updated', '编辑订单', `现有 ${items.length} 条明细`, operator)
    await buildPricingEvents(conn, id, items, operator)
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 执行期改单：已占库/拣货中（对应仓库任务在活跃阶段）均可修改明细——增减数量、
// 新增/删除商品行。按 product_id 聚合新旧明细算出净变化，逐 product 委托
// warehouse-tasks.adjust.js 分层处理（增量直接生效补拣；减量视命中深度决定是否需要
// PDA 物理确认）。sale_order_items 本身仍是整表删除重建（同 update() 的模式），
// 因为这是唯一用户可见的"行"，WMS 侧只认按商品聚合后的净数量，详见方案说明。
async function requestAdjustment(id, { items, operator, requestKey }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'sale.adjust',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const orderRow = await lockStatusRow(conn, {
      table: 'sale_orders', id,
      columns: 'id, order_no, status, task_id, task_no, warehouse_id, warehouse_name',
      entityName: '销售单',
    })
    assertStatusAction('sale', 'adjust', orderRow.status)
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
    if (!orderRow.task_id) throw new AppError('销售单尚未发起出库，没有关联的仓库任务', 400)

    const taskRow = await lockStatusRow(conn, {
      table: 'warehouse_tasks', id: orderRow.task_id,
      columns: 'id, task_no, status, cancel_requested_at, adjustment_requested_at',
      entityName: '仓库任务',
    })
    if (taskRow.cancel_requested_at) throw new AppError('该任务正在取消收尾中，暂不能改单', 409)
    if (taskRow.adjustment_requested_at) throw new AppError('该任务已有改单在等待仓库确认，请先处理完成', 409)
    if (!WT_STATUS_ACTIVE.includes(Number(taskRow.status))) {
      throw new AppError('当前仓库任务状态不支持改单', 400)
    }

    if (!items || !items.length) throw new AppError('至少需要一条商品明细', 400)

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
    for (const item of items) {
      const pid = Number(item.productId)
      newQtyByProduct.set(pid, (newQtyByProduct.get(pid) || 0) + Number(item.quantity))
      if (!productMeta.has(pid)) {
        productMeta.set(pid, {
          productCode: item.productCode, productName: item.productName, unit: item.unit,
          articleNumber: item.articleNumber || null, spec: item.spec || null, color: item.color || null,
        })
      }
    }

    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    await conn.query('UPDATE sale_orders SET total_amount=? WHERE id=?', [total, id])
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
    for (const item of items) {
      await conn.query(
        `INSERT INTO sale_order_items (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark,dispatched) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [id, keptWarehouseId, keptWarehouseName, item.productId, item.productCode, item.productName, item.unit, item.articleNumber||null, item.spec||null, item.color||null, item.quantity, item.unitPrice, item.quantity*item.unitPrice, item.remark||null]
      )
    }

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
          'SELECT product_code, product_name, unit FROM warehouse_task_items WHERE task_id=? AND product_id=?',
          [orderRow.task_id, pid],
        )
        meta = ti
          ? { productCode: ti.product_code, productName: ti.product_name, unit: ti.unit }
          : { productCode: '', productName: `商品#${pid}`, unit: '' }
      }
      const descriptor = await adjustSvc.applyProductDeltaWithinTransaction(conn, {
        taskId: Number(orderRow.task_id),
        warehouseId: Number(orderRow.warehouse_id),
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

// 占库前的分仓预览：按明细行的产品，列出各仓库当前可用量，供占库弹窗逐行选仓库。
async function getReservePreview(id, scopeWarehouseIds = null) {
  const [[orderRow]] = await pool.query(
    'SELECT id, status, warehouse_id, warehouse_name FROM sale_orders WHERE id = ?', [id],
  )
  if (!orderRow) throw new AppError('销售单不存在', 404)
  assertStatusAction('sale', 'reserve', orderRow.status)
  const [itemRows] = await pool.query('SELECT * FROM sale_order_items WHERE order_id = ? ORDER BY id', [id])
  if (!itemRows.length) throw new AppError('销售单无明细，无法占用库存', 400)

  const productIds = [...new Set(itemRows.map(r => r.product_id))]
  const availability = await getAvailabilityByProducts({ productIds, scopeWarehouseIds })
  const availByProduct = new Map()
  for (const a of availability) {
    if (!availByProduct.has(a.productId)) availByProduct.set(a.productId, [])
    availByProduct.get(a.productId).push({ warehouseId: a.warehouseId, warehouseName: a.warehouseName, available: a.available })
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
      currentWarehouseId: item.warehouse_id != null ? Number(item.warehouse_id) : Number(orderRow.warehouse_id),
      currentWarehouseName: item.warehouse_name || orderRow.warehouse_name,
      warehouses: (availByProduct.get(item.product_id) || []).sort((a, b) => b.available - a.available),
    })),
  }
}

// ① 占用库存：仅调用 reservationEngine.reserve()，不创建仓库任务
//
// 先做一次全量可用量检查（不实际预占），把所有不足的商品一次性收集进错误明细——
// 而不是像 reserve() 循环那样第一个不足就抛错、后面的商品可用量对用户完全不可见。
// 前端可用这份明细直接展示"按可用量修改订单"的一键操作（见 requestAdjustment）。
//
// itemOverrides：占库弹窗里逐行选好的发货仓库（[{id, warehouseId, warehouseName}]），
// 在可用量检查前先写回明细行，让 shortages 按用户选的仓库计算。
async function reserveStock(id, operator, itemOverrides = []) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    const rule = assertStatusAction('sale', 'reserve', orderRow.status)

    if (itemOverrides.length) {
      for (const o of itemOverrides) {
        await conn.query(
          'UPDATE sale_order_items SET warehouse_id = ?, warehouse_name = ? WHERE id = ? AND order_id = ?',
          [o.warehouseId, o.warehouseName, o.id, id],
        )
      }
    }

    const [itemRows] = await conn.query('SELECT * FROM sale_order_items WHERE order_id = ? ORDER BY id', [id])
    if (!itemRows.length) throw new AppError('销售单无明细，无法占用库存', 400)

    // 可用量按明细行自己的仓库检查（分仓订单不同行可能在不同仓库；缺省行仓库=订单头）
    const itemWh = item => (item.warehouse_id != null ? Number(item.warehouse_id) : Number(orderRow.warehouse_id))
    const shortages = []
    for (const item of itemRows) {
      const { available } = await getAvailableStockForDecision(conn, {
        productId: item.product_id,
        warehouseId: itemWh(item),
        lock: false,
      })
      if (available < Number(item.quantity)) {
        shortages.push({
          productId: item.product_id,
          productName: item.product_name,
          warehouseName: item.warehouse_name || orderRow.warehouse_name,
          required: Number(item.quantity),
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

    // 按 (product_id, warehouse_id) 排序后再逐行预占，强制所有并发事务以同一顺序获取
    // inventory_stock 行锁。明细行的自然顺序（ORDER BY id）与商品无关，两张订单若商品
    // 顺序相反就会互相持锁等待 → InnoDB 死锁，随机报「占库失败」。统一加锁顺序是消除
    // 这类死锁的标准手法（审计 P1-6）。
    const reserveOrder = [...itemRows].sort(
      (a, b) => Number(a.product_id) - Number(b.product_id) || itemWh(a) - itemWh(b),
    )
    for (const item of reserveOrder) {
      await reserve(conn, {
        productId:   item.product_id,
        productName: item.product_name,
        warehouseId: itemWh(item),
        qty:         Number(item.quantity),
        refType:     'sale_order',
        refId:       Number(orderRow.id),
        refNo:       orderRow.order_no,
      })
    }
    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
    })
    await appendSaleEvent(conn, id, 'reserved', '确认占库', `已预占库存`, operator)
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ② 发起出库：按明细行的发货仓库分组，每个仓库创建一个仓库任务，不扣减库存，
// 订单进入拣货中（status=3）。单仓订单 = 只有一组 = 一个任务（与旧行为一致）。
// sale_orders.task_id/task_no 记录"最近创建的任务"（兼容旧字段，主查询走 sale_order_id 反查）。
//
// 分批发货：只对「未派发(dispatched=0)」且（传了 itemIds 时）被选中的行建任务，
// 建完标记 dispatched=1。首次发货 status 2→3；后续继续发剩余行时订单已在 3，保持不变。
// 不传 itemIds = 发全部未派发行（含首次一次性全发的旧行为）。
async function ship(id, operator, { itemIds = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    const curStatus = Number(orderRow.status)
    // 允许从「已占库(2)」首次发货，或「履约中(3)」继续发剩余行；其它状态走标准报错
    if (curStatus !== 2 && curStatus !== 3) {
      assertStatusAction('sale', 'ship', orderRow.status)
    }

    // 取未派发行；传了 itemIds 则只发选中的那些未派发行（分批）
    let [itemRows] = await conn.query(
      'SELECT * FROM sale_order_items WHERE order_id = ? AND dispatched = 0 ORDER BY id',
      [id],
    )
    if (!itemRows.length) throw new AppError('该销售单已无未发货明细，无需再发起出库', 400)
    if (Array.isArray(itemIds) && itemIds.length) {
      const wanted = new Set(itemIds.map(Number))
      itemRows = itemRows.filter(r => wanted.has(Number(r.id)))
      if (!itemRows.length) throw new AppError('选中的明细行均已发起出库，无可发货项', 400)
    }

    // 按发货仓库分组（缺省行仓库=订单头）
    const groups = new Map()
    for (const r of itemRows) {
      const whId = r.warehouse_id != null ? Number(r.warehouse_id) : Number(orderRow.warehouse_id)
      const whName = r.warehouse_name || orderRow.warehouse_name
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
        quantity: Number(r.quantity),
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
    // 标记本次已派发的行
    await conn.query(
      'UPDATE sale_order_items SET dispatched = 1 WHERE id IN (?)',
      [itemRows.map(r => r.id)],
    )

    const last = created[created.length - 1]
    if (curStatus === 2) {
      // 首次发货：已占库(2) → 履约中(3)
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

    // 是否还有未派发行（用于事件描述与前端「继续发货」入口判断）
    const [[{ remaining }]] = await conn.query(
      'SELECT COUNT(*) AS remaining FROM sale_order_items WHERE order_id = ? AND dispatched = 0',
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
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 取消占库：RESERVED(2) → DRAFT(1)，释放预占
async function releaseStock(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    const rule = assertStatusAction('sale', 'release', orderRow.status)
    await releaseByRef(conn, 'sale_order', id)
    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
    })
    await appendSaleEvent(conn, id, 'released', '取消占库', `销售单 ${orderRow.order_no} 已取消占库并恢复草稿`, operator)
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 取消订单：仅 DRAFT(1) → CANCELLED(5)
async function cancel(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    const rule = assertStatusAction('sale', 'cancel', orderRow.status)

    if (Number(orderRow.status) === 2) {
      await releaseByRef(conn, 'sale_order', id)
    }

    if (Number(orderRow.status) === 3) {
      const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
      // 分仓：一个订单可能有多个仓库任务。遍历所有关联任务——已出库(7)的不能取消（货已发出），
      // 其余活跃任务逐个取消（taskSvc.cancel 内部走逆向归还判断，并释放该订单未履行的预占）。
      const [tasks] = await conn.query(
        'SELECT id, status FROM warehouse_tasks WHERE sale_order_id = ? AND deleted_at IS NULL',
        [id],
      )
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
              'UPDATE sale_order_items SET quantity = ?, amount = ? WHERE id = ?',
              [shipped, shipped * Number(item.unit_price), item.id],
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
        await conn.query('UPDATE sale_orders SET total_amount = ? WHERE id = ?', [total, id])

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
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// 删除订单：仅 CANCELLED(5) 可删
async function deleteOrder(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 在事务内读取并锁定订单行，防止并发状态变更
    const [[order]] = await conn.query(
      'SELECT id, status, order_no FROM sale_orders WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [id],
    )
    if (!order) throw new AppError('订单不存在', 404)
    assertStatusAction('sale', 'delete', order.status)
    await conn.query('UPDATE sale_orders SET deleted_at=NOW() WHERE id=?', [id])
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
