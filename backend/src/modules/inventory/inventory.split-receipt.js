const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const BASE = 'inventory.container.split'
const isSplitAction = action => typeof action === 'string' && (action === BASE || /^inventory\.container\.split\.[1-9]\d*$/.test(action))
const id = value => Number.isSafeInteger(value) && value > 0
const invalid = () => { throw new AppError('拆分结果身份不完整或不一致，请保留原请求并人工核对', 409, 'CONTAINER_SPLIT_RECEIPT_INVALID') }
function requireSplitDeviceWarehouse(isPda, warehouseId) {
  if (isPda && (warehouseId == null || !Number.isSafeInteger(Number(warehouseId)) || Number(warehouseId) <= 0)) {
    throw new AppError('设备尚未绑定有效仓库，无法执行或核对拆分操作', 403, 'PDA_WAREHOUSE_REQUIRED')
  }
}
/** 本人key/action已由公共查询匹配。核原操作快照与流水，不拿之后的仓/状态/量推测历史。 */
async function assertSplitReceipt(conn, receipt, scopeWarehouseIds, context = {}) {
  if (!isSplitAction(context.matchedAction) && !isSplitAction(context.requestedAction)) return
  requireSplitDeviceWarehouse(context.isPda === true, context.pdaWarehouseId)
  if (receipt.status !== 'success') return
  const d = receipt.data
  if (!d || receipt.resourceType !== 'inventory_container' || !id(receipt.resourceId)
      || !id(d.sourceContainerId) || d.sourceContainerId !== receipt.resourceId || !id(d.newContainerId) || d.newContainerId === d.sourceContainerId
      // 既有PC容器可有非数字条码；身份由下面的ID+完整条码+原流水精确核对，不用新造码格式推断。
      || !id(d.productId) || !id(d.warehouseId) || typeof d.sourceBarcode !== 'string' || !d.sourceBarcode.trim() || [...d.sourceBarcode].length > 64
      || typeof d.newBarcode !== 'string' || !/^B\d+$/.test(d.newBarcode) || d.newContainerKind !== 'plastic_box') invalid()
  for (const action of [context.matchedAction, context.requestedAction]) if (isSplitAction(action) && action !== BASE && action !== `${BASE}.${d.sourceContainerId}`) invalid()
  if (d.targetContainerId != null && (d.targetContainerId !== d.newContainerId || d.targetBarcode !== d.newBarcode)) invalid()
  assertInScope(scopeWarehouseIds, d.warehouseId, '原拆分操作仓库')
  if (context.pdaWarehouseId != null && Number(context.pdaWarehouseId) !== d.warehouseId) throw new AppError('原拆分操作不属于当前PDA绑定仓库', 403)
  // barcode 是不可变容器身份；流水仓是拆分发生时的仓，不要求现在仍在原仓或ACTIVE。
  // 等维度锁后的写事务重放须当前读；本人独立查询沿用无锁读。
  const [logs] = await conn.query(
    `SELECT DISTINCT l.container_id,l.warehouse_id
       FROM inventory_logs l JOIN inventory_containers c ON c.id=l.container_id
      WHERE l.ref_type='container_split' AND l.ref_id=? AND l.log_source_type='container_split'
        AND l.log_source_ref_id=? AND l.product_id=? AND l.warehouse_id=?
        AND ((c.id=? AND c.barcode=?) OR (c.id=? AND c.barcode=?)) ${context.currentRead === true ? 'FOR SHARE' : ''}`,
    [d.sourceContainerId, d.sourceContainerId, d.productId, d.warehouseId, d.sourceContainerId, d.sourceBarcode, d.newContainerId, d.newBarcode],
  )
  if (![d.sourceContainerId, d.newContainerId].every(cid => logs.some(r => Number(r.container_id) === cid && Number(r.warehouse_id) === d.warehouseId))) invalid()
}
module.exports = { assertSplitReceipt, isSplitAction, requireSplitDeviceWarehouse }
