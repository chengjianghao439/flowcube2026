const AppError = require('../../utils/AppError')
const invalid = () => new AppError('补打来源已删除或归属已变化，请核对原单据', 409, 'PRINT_REPRINT_SOURCE_INVALID')
// 同一谓词用于中心、详情及回执读取；无收货来源的其它库存标签仍走原用途守卫。
const sourceColumns = `c.*, t.id AS source_task_id, t.warehouse_id AS source_warehouse_id,
 t.deleted_at AS source_deleted_at,
 (SELECT COUNT(*) FROM inbound_task_items i WHERE i.task_id=c.inbound_task_id AND i.product_id=c.product_id
   AND (c.inbound_task_item_id IS NULL OR i.id=c.inbound_task_item_id)) AS source_item_count`
function assertContainerReprintSource(row, scopeWarehouseIds, { recovery = false } = {}) {
  const { assertBoundWarehouseInScope } = require('../../utils/warehouseScope')
  const { CONTAINER_STATUS } = require('../../engine/containerEngine')
  if (!row) throw new AppError('条码来源不存在', 404, 'PRINT_BARCODE_RECORD_NOT_FOUND')
  assertBoundWarehouseInScope(scopeWarehouseIds, row.warehouse_id, '补打来源')
  if (Number(row.status) === CONTAINER_STATUS.VOID) throw new AppError('该库存条码已作废，不能再补打', 400, 'PRINT_BARCODE_CONTAINER_VOID')
  const inbound = row.inbound_task_id != null || row.source_ref_type === 'inbound_task'
  if (inbound) {
    if (!row.source_task_id || row.source_deleted_at || Number(row.source_item_count) !== 1
      || row.source_ref_type === 'inbound_task' && Number(row.source_ref_id) !== Number(row.inbound_task_id)) throw invalid()
    assertBoundWarehouseInScope(scopeWarehouseIds, row.source_warehouse_id, '收货来源')
  }
  if (recovery && (!inbound || Number(row.is_legacy) || row.source_ref_type !== 'inbound_task')) throw invalid()
  return row
}
const identity = row => ({ containerId: Number(row.id), taskId: row.inbound_task_id == null ? null : Number(row.inbound_task_id), itemId: row.inbound_task_item_id == null ? null : Number(row.inbound_task_item_id), productId: Number(row.product_id), sourceRefType: row.source_ref_type, sourceRefId: row.source_ref_id == null ? null : Number(row.source_ref_id) })
async function readContainerReprintSources(conn, ids) {
  if (!ids.length) return []
  const [rows] = await conn.query(`SELECT ${sourceColumns} FROM inventory_containers c LEFT JOIN inbound_tasks t ON t.id=c.inbound_task_id WHERE c.id IN (?) AND c.deleted_at IS NULL ORDER BY c.id`, [ids])
  return rows
}
async function lockContainerReprintSource(conn, id, scopeWarehouseIds, options) {
  const [[peek]] = await conn.query('SELECT inbound_task_id FROM inventory_containers WHERE id=? AND deleted_at IS NULL', [id])
  if (!peek) throw new AppError('条码来源不存在', 404, 'PRINT_BARCODE_RECORD_NOT_FOUND')
  if (peek.inbound_task_id != null) {
    const [[head]] = await conn.query('SELECT id FROM inbound_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE', [peek.inbound_task_id])
    if (!head) throw new AppError('收货来源不存在', 404, 'PRINT_BARCODE_RECORD_NOT_FOUND')
  }
  const [[row]] = await conn.query('SELECT * FROM inventory_containers WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
  if (!row || row.inbound_task_id !== peek.inbound_task_id) throw invalid()
  const [current] = await readContainerReprintSources(conn, [id])
  return assertContainerReprintSource(current, scopeWarehouseIds, options)
}
module.exports = { assertContainerReprintSource, lockContainerReprintSource, readContainerReprintSources, identity }
