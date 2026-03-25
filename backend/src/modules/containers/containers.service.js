const { pool } = require('../../config/db')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')
const inboundTasksSvc = require('../inbound-tasks/inbound-tasks.service')

/**
 * 监控：待上架且已标记超时的容器（先刷新超时标记）
 */
async function listOverduePending() {
  await inboundTasksSvc.refreshPutawayOverdueMarks()

  const [rows] = await pool.query(
    `SELECT c.id, c.barcode, c.product_id, c.warehouse_id, c.remaining_qty,
            c.created_at, c.putaway_deadline_at, c.is_overdue, c.putaway_flagged_overdue,
            c.inbound_task_id, c.source_type, c.source_ref_id, c.source_ref_no,
            t.task_no, t.purchase_order_no, t.warehouse_name,
            p.code AS product_code, p.name AS product_name
     FROM inventory_containers c
     LEFT JOIN inbound_tasks t ON t.id = c.inbound_task_id AND t.deleted_at IS NULL
     LEFT JOIN product_items p ON p.id = c.product_id
     WHERE c.status = ? AND c.deleted_at IS NULL
       AND (c.is_overdue = 1 OR c.putaway_flagged_overdue = 1)
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
     ORDER BY c.putaway_deadline_at ASC, c.created_at ASC`,
    [CONTAINER_STATUS.PENDING_PUTAWAY],
  )

  return rows.map(r => ({
    id: r.id,
    barcode: r.barcode,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name,
    qty: Number(r.remaining_qty),
    createdAt: r.created_at,
    putawayDeadlineAt: r.putaway_deadline_at,
    isOverdue: !!Number(r.is_overdue ?? r.putaway_flagged_overdue),
    inboundTaskId: r.inbound_task_id,
    taskNo: r.task_no,
    purchaseOrderNo: r.purchase_order_no,
    sourceType: r.source_type,
    sourceRefId: r.source_ref_id != null ? Number(r.source_ref_id) : null,
    sourceRefNo: r.source_ref_no,
  }))
}

module.exports = { listOverduePending }
