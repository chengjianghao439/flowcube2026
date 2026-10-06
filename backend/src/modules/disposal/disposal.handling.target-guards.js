'use strict'
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertQtyScale } = require('../../utils/qtyPrecision')

const invalid = () => new AppError('处理关联的目标身份或基本量不一致，请保留原记录核对', 409, 'DISPOSAL_HANDLING_TARGET_INVALID')
const positiveId = value => (typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0
function quantity(value, positive = false) {
  const n = Number(value)
  if (value == null || String(value).trim() === '' || !Number.isFinite(n) || n < 0 || positive && n === 0 || n > 9999999999.99) throw invalid()
  try { assertQtyScale(n) } catch { throw invalid() }
  return Math.round(n * 100)
}
// Called only after the original target head X lock. No source reads or locks:
// in particular, this PK current read must not establish an RR view before customer X.
async function readLink(conn, head, type, scopeWarehouseIds = null) {
  const marker = head.disposal_handling_link_id
  if (marker === null) return null
  if (!positiveId(marker) || !positiveId(head.id) || !positiveId(head.warehouse_id)) throw invalid()
  const [[link]] = await conn.query('SELECT * FROM disposal_handling_links WHERE id=? FOR SHARE', [Number(marker)])
  if (!link || Number(link.id) !== Number(marker) || link.target_type !== type || Number(link.target_id) !== Number(head.id)
    || ![link.source_id, link.target_line_id, link.product_id, link.warehouse_id].every(positiveId)
    || Number(link.warehouse_id) !== Number(head.warehouse_id) || typeof link.unit !== 'string' || !link.unit || link.unit !== link.unit.trim()
    || type === 'sale_order' && head.commercial_model != null) throw invalid()
  assertInScope(scopeWarehouseIds, link.warehouse_id, '处理关联目标')
  const a = quantity(link.allocated_quantity, true), r = quantity(link.released_quantity)
  const e = link.final_executed_quantity == null ? null : quantity(link.final_executed_quantity)
  if (r > a || e != null && (e > a || r > a - e)
    || link.state === 'ACTIVE' && (r !== 0 || e != null)
    || link.state === 'TERMINATED' && (e == null || r !== a - e)
    || !['ACTIVE', 'TERMINATED'].includes(link.state)) throw invalid()
  return link
}
function assertEditable(link) {
  if (link) throw new AppError('关联处理来源的明细已固定，不能编辑或改单；请沿原取消/关闭剩余流程处理', 409, 'DISPOSAL_HANDLING_TARGET_EDIT_FORBIDDEN')
}
function assertSaleItems(link, items, head) {
  if (!link) return
  if (link.state !== 'ACTIVE' || !Array.isArray(items) || items.length !== 1) throw invalid()
  const row = items[0]
  if (Number(row.id) !== Number(link.target_line_id) || Number(row.order_id) !== Number(head.id)
    || Number(row.product_id) !== Number(link.product_id) || Number(row.warehouse_id ?? head.warehouse_id) !== Number(link.warehouse_id)
    || row.unit !== link.unit || quantity(row.quantity, true) !== quantity(link.allocated_quantity, true)) throw invalid()
}
function assertWarehouse(link, warehouseId) {
  if (link && Number(warehouseId) !== Number(link.warehouse_id)) throw new AppError('关联处理目标必须保留原仓库，释放预占后也不能换仓', 409, 'DISPOSAL_HANDLING_TARGET_WAREHOUSE_CHANGED')
}
// This is deliberately a non-locking, conservative RR fact gate after SO X.
// Do not take WT S/X here: ready/return holds WT before touching SO.
async function assertDeleteClosed(conn, head, link) {
  if (!link) return
  const [pending] = await conn.query(
    `SELECT wt.id FROM warehouse_tasks wt WHERE wt.sale_order_id=? AND (
       wt.cancel_requested_at IS NOT NULL OR wt.adjustment_requested_at IS NOT NULL
       OR wt.status NOT IN (7,8)
       OR EXISTS (SELECT 1 FROM inventory_containers c WHERE c.locked_by_task_id=wt.id)
       OR (wt.status<>7 AND EXISTS (SELECT 1 FROM packages p WHERE p.warehouse_task_id=wt.id AND p.status=2))
     ) LIMIT 1`, [head.id],
  )
  if (pending.length) throw new AppError('请先完成原仓库任务的实物归还，再删除关联销售单', 409, 'DISPOSAL_HANDLING_PHYSICAL_RETURN_PENDING')
}
async function saleShipContext(conn, head, task, link) {
  const [items] = await conn.query('SELECT id,order_id,product_id,product_name,warehouse_id,unit,quantity,shipped_qty,unit_price FROM sale_order_items WHERE order_id=? ORDER BY id FOR SHARE', [head.id])
  assertSaleItems(link, items, head)
  const item = items[0]
  const [taskItems] = await conn.query('SELECT id,task_id,product_id,product_name,unit,required_qty,picked_qty FROM warehouse_task_items WHERE task_id=? ORDER BY id FOR SHARE', [task.id])
  if (task.task_type !== 'sale_out' || Number(task.sale_order_id) !== Number(head.id) || Number(task.warehouse_id) !== Number(link.warehouse_id)
    || taskItems.length !== 1) throw invalid()
  const taskItem = taskItems[0], picked = quantity(taskItem.picked_qty, true), required = quantity(taskItem.required_qty, true)
  if (Number(taskItem.task_id) !== Number(task.id) || Number(taskItem.product_id) !== Number(link.product_id) || taskItem.unit !== link.unit
    || picked !== required || picked > quantity(link.allocated_quantity, true)
    || picked + quantity(item.shipped_qty) > quantity(item.quantity, true)
    || item.unit_price == null || !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0) throw invalid()
  // totalAmount retains the original whole-SO event meaning, not this task's subtotal.
  return { warehouseId: Number(task.warehouse_id), totalAmount: Number(head.total_amount), items: [{ productId: Number(item.product_id), productName: item.product_name, quantity: picked / 100, unitPrice: Number(item.unit_price) }] }
}
module.exports = { readLink, assertEditable, assertSaleItems, assertWarehouse, assertDeleteClosed, saleShipContext }
