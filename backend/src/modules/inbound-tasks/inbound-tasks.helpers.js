const { generateDailyCode } = require('../../utils/codeGenerator')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')

const TASK_STATUS = { 1: '待收货', 2: '收货中', 3: '待上架', 4: '已完成', 5: '已取消' }

const genTaskNo = conn => generateDailyCode(conn, 'IT', 'inbound_tasks', 'task_no')

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
  unit: r.unit || null,
  orderedQty: Number(r.ordered_qty),
  receivedQty: Number(r.received_qty),
  putawayQty: Number(r.putaway_qty),
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
  unit: r.unit || null,
  orderedQty: Number(r.ordered_qty),
  assignedQty: Number(r.assigned_qty),
  remainingQty: Number(r.remaining_qty),
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
    status: r.status === CONTAINER_STATUS.PENDING_PUTAWAY ? 'waiting_putaway' : 'stored',
    locationId: r.location_id || null,
    locationCode: r.location_code || null,
    createdAt: r.created_at,
  }
}

module.exports = {
  TASK_STATUS,
  genTaskNo,
  parseJson,
  appendInboundEvent,
  fmtTask,
  fmtItem,
  fmtPurchasableItem,
  fmtContainer,
}
