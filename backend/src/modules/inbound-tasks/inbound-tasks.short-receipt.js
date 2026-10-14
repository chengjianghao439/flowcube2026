const AppError = require('../../utils/AppError')
const { qtyUnits } = require('./inbound-tasks.cost')

// Closed receipt batches retain their original plan, but only their real receipt
// quantity remains allocated. The unreceived commitment belongs to the open PO.
const EFFECTIVE_ASSIGNED_QTY_SQL = "CASE WHEN it.closed_reason = 'short_close' THEN iti.received_qty ELSE iti.ordered_qty END"

async function assertShortReceiptCanReopen(conn, task) {
  // Caller holds this IT and its accurate source POs. RC reads current committed
  // other batches without reversing the lock order by locking their heads/items.
  const [rows] = await conn.query(
    `SELECT own.purchase_item_id, own.ordered_qty,
            poi.quantity AS purchase_qty, po.status AS purchase_status,
            po.closed_reason AS purchase_closed_reason,
            COALESCE((SELECT SUM(${EFFECTIVE_ASSIGNED_QTY_SQL})
              FROM inbound_task_items iti JOIN inbound_tasks it ON it.id=iti.task_id
              WHERE iti.purchase_item_id=own.purchase_item_id AND iti.task_id<>?
                AND it.deleted_at IS NULL AND it.status<>5),0) AS other_assigned_qty
       FROM inbound_task_items own
       JOIN purchase_order_items poi ON poi.id=own.purchase_item_id
       JOIN purchase_orders po ON po.id=own.purchase_order_id
       WHERE own.task_id=? ORDER BY own.purchase_item_id`,
    [task.id, task.id],
  )
  if (rows.some(row => Number(row.purchase_status) === 3 && row.purchase_closed_reason === 'short_close')) {
    throw new AppError('原采购单已明确结束剩余采购，不能通过撤回收货重新打开；请核对后按采购退货等原业务处理', 409, 'PURCHASE_REMAINDER_CLOSED')
  }
  if (task.closed_reason !== 'short_close') return
  if (rows.some(row => qtyUnits(row.ordered_qty) + qtyUnits(row.other_assigned_qty) > qtyUnits(row.purchase_qty))) {
    throw new AppError('本次未收余量已有后续收货任务承接，撤回会重复分配；请先处理后续未执行任务，已执行实物请按采购退货处理', 409, 'INBOUND_SHORT_RECEIPT_FOLLOWUP_EXISTS')
  }
}

async function assertCloseReceivingReceipt(db, receipt, scopeWarehouseIds, context = {}) {
  const requested = /^inbound\.closeReceiving(?:\.([1-9]\d*))?$/.exec(String(context.requestedAction ?? ''))
  const matched = /^inbound\.closeReceiving(?:\.([1-9]\d*))?$/.exec(String(context.matchedAction ?? ''))
  if (!requested && !matched) return
  const invalid = () => new AppError('原结束收货结果与收货单不一致，请保留原请求核对', 409, 'INBOUND_CLOSE_RECEIPT_INVALID')
  const id = Number(requested?.[1] ?? matched?.[1] ?? receipt?.resourceId)
  if (!Number.isSafeInteger(id) || id <= 0 || (requested?.[1] && matched?.[1] && requested[1] !== matched[1])) throw invalid()
  const [[task]] = await db.query('SELECT id,warehouse_id FROM inbound_tasks WHERE id=?', [id])
  if (!task || Number(task.id) !== id) throw invalid()
  require('../../utils/warehouseScope').assertInScope(scopeWarehouseIds, task.warehouse_id, '收货订单')
  if (receipt?.status === 'success' && (receipt.resourceType !== 'inbound_task'
    || Number(receipt.resourceId) !== id || Number(receipt.data?.taskId) !== id
    || ![3, 4].includes(Number(receipt.data?.status)))) throw invalid()
}

module.exports = { EFFECTIVE_ASSIGNED_QTY_SQL, assertShortReceiptCanReopen, assertCloseReceivingReceipt }
