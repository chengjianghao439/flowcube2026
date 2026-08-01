const { generateDailyCode } = require('../../utils/codeGenerator')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')
const AppError = require('../../utils/AppError')

const TASK_STATUS = { 1: '待收货', 2: '收货中', 3: '待上架', 4: '已完成', 5: '已取消' }

const genTaskNo = conn => generateDailyCode(conn, 'IT', 'inbound_tasks', 'task_no')

async function assertPurchaseOrderOpen(conn, purchaseOrderId, actionLabel = '收货') {
  if (!Number.isFinite(Number(purchaseOrderId)) || Number(purchaseOrderId) <= 0) return
  const [[purchaseRow]] = await conn.query(
    'SELECT id, order_no, status FROM purchase_orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
    [purchaseOrderId],
  )
  if (!purchaseRow) throw new AppError('关联采购单不存在', 404)
  if (Number(purchaseRow.status) === 4) {
    throw new AppError(`采购单 ${purchaseRow.order_no} 已取消，不能继续${actionLabel}`, 409)
  }
}

/**
 * 校验收货订单涉及的所有采购单均未取消。混合采购单收货单的 inbound_tasks.purchase_order_id
 * 头字段为空，因此从 inbound_task_items 按明细归属的采购单逐一查，而非只看头字段。
 * receive()、putaway() 都要过这道校验，任何一处只看头字段都会在混单场景下漏检。
 */
async function assertPurchaseOrdersOpen(conn, taskId, actionLabel = '收货') {
  const [rows] = await conn.query(
    'SELECT DISTINCT purchase_order_id FROM inbound_task_items WHERE task_id = ?',
    [taskId],
  )
  for (const row of rows) {
    await assertPurchaseOrderOpen(conn, Number(row.purchase_order_id), actionLabel)
  }
}

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

async function appendInboundEvent(conn, taskId, eventType, title, description = null, operator = null, payload = null) {
  await conn.query(
    `INSERT INTO inbound_task_events (task_id,event_type,title,description,payload_json,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?)`,
    [
      taskId,
      eventType,
      title,
      description || null,
      payload ? JSON.stringify(payload) : null,
      operator?.userId ?? null,
      operator?.realName ?? operator?.username ?? null,
    ],
  )
}

const fmtTask = r => ({
  id: r.id,
  taskNo: r.task_no,
  purchaseOrderId: r.purchase_order_id,
  purchaseOrderNo: r.purchase_order_no || null,
  supplierName: r.supplier_name || null,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name || null,
  status: r.status,
  statusName: TASK_STATUS[r.status],
  loopStatus:
    r.status === 1 ? 'pending_receive'
      : r.status === 2 ? 'pending_receive'
        : r.status === 3 ? 'pending_putaway'
          : r.status === 4 ? 'done'
            : r.status === 5 ? 'cancelled' : 'unknown',
  operatorId: r.operator_id || null,
  operatorName: r.operator_name || null,
  remark: r.remark || null,
  submittedAt: r.submitted_at || null,
  submittedBy: r.submitted_by != null ? Number(r.submitted_by) : null,
  submittedByName: r.submitted_by_name || null,
  auditStatus: Number(r.audit_status || 0),
  qaStatus: Number(r.qa_status || 0),   // 0无需/无待质检 1有待质检容器 2质检已完成（文档07旁路标志）
  auditRemark: r.audit_remark || null,
  auditedAt: r.audited_at || null,
  auditedBy: r.audited_by != null ? Number(r.audited_by) : null,
  auditedByName: r.audited_by_name || null,
  lockVersion: Number(r.lock_version) || 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const fmtItem = r => ({
  id: r.id,
  taskId: r.task_id,
  purchaseOrderId: r.purchase_order_id != null ? Number(r.purchase_order_id) : null,
  purchaseOrderNo: r.purchase_order_no || null,
  purchaseItemId: r.purchase_item_id != null ? Number(r.purchase_item_id) : null,
  productId: r.product_id,
  productCode: r.product_code || null,
  productName: r.product_name,
  articleNumber: r.article_number || null,
  spec: r.spec || null,
  color: r.color || null,
  unit: r.unit || null,
  orderedQty: Number(r.ordered_qty),
  receivedQty: Number(r.received_qty),
  putawayQty: Number(r.putaway_qty),
  // 来料质检（文档07）：qa_required 快照 + 已质检/拒收量；免检行 qaRequired=false、两量恒0
  qaRequired: Number(r.qa_required) === 1,
  checkedQty: Number(r.checked_qty || 0),
  rejectedQty: Number(r.rejected_qty || 0),
  // 序列号管控开关是商品维度属性（product_items.serial_managed），联表带出供 PDA 收货判断是否逐台扫 SN；
  // 未联表的调用方（如 receive() 内部刷新明细）r.serial_managed 为 undefined → false，不影响非管控链路。
  serialManaged: Number(r.serial_managed) === 1,
  // 价格不落在 inbound_task_items 上，只在联表查询里现查（跟结算时 recomputePurchasePayable
  // 的取价方式一致，避免出现"页面显示的价格"和"实际结算价格"两个数据源）；
  // 没联表查询的调用方（如 receive() 里刷新明细）这里就是 null，不当成 0 处理。
  unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
})

const fmtPurchasableItem = r => ({
  purchaseItemId: Number(r.purchase_item_id),
  purchaseOrderId: Number(r.purchase_order_id),
  purchaseOrderNo: r.purchase_order_no,
  supplierId: Number(r.supplier_id),
  supplierName: r.supplier_name,
  warehouseId: Number(r.warehouse_id),
  warehouseName: r.warehouse_name,
  productId: Number(r.product_id),
  productCode: r.product_code,
  productName: r.product_name,
  articleNumber: r.article_number || null,
  spec: r.spec || null,
  color: r.color || null,
  unit: r.unit || null,
  orderedQty: Number(r.ordered_qty),
  assignedQty: Number(r.assigned_qty),
  remainingQty: Number(r.remaining_qty),
  receivedQty: Number(r.received_qty),
  unitPrice: Number(r.unit_price),
})

function fmtContainer(r) {
  return {
    id: r.id,
    barcode: r.barcode,
    taskId: r.inbound_task_id,
    productId: r.product_id,
    productCode: r.product_code || null,
    productName: r.product_name || null,
    qty: Number(r.remaining_qty),
    unit: r.unit || null,
    status: r.status === CONTAINER_STATUS.PENDING_PUTAWAY ? 'waiting_putaway'
      : r.status === CONTAINER_STATUS.REJECTED ? 'rejected'
      : 'stored',
    locationId: r.location_id || null,
    locationCode: r.location_code || null,
    createdAt: r.created_at,
  }
}

module.exports = {
  TASK_STATUS,
  genTaskNo,
  assertPurchaseOrderOpen,
  assertPurchaseOrdersOpen,
  parseJson,
  appendInboundEvent,
  fmtTask,
  fmtItem,
  fmtPurchasableItem,
  fmtContainer,
}
