const AppError = require('../../utils/AppError')

// Querying one's own original result does not grant purchase VIEW/write rights;
// current original warehouse scope still applies to success and unknown results.
async function assertPurchaseCloseReceipt(db, receipt, scopeWarehouseIds, context = {}) {
  const requested = /^purchase\.closeRemaining(?:\.([1-9]\d*))?$/.exec(String(context.requestedAction ?? ''))
  const matched = /^purchase\.closeRemaining(?:\.([1-9]\d*))?$/.exec(String(context.matchedAction ?? ''))
  if (!requested && !matched) return
  const invalid = () => new AppError('原结束剩余采购结果与采购单不一致，请保留原请求核对', 409, 'PURCHASE_CLOSE_RECEIPT_INVALID')
  const id = Number(requested?.[1] ?? matched?.[1] ?? receipt?.resourceId)
  if (!Number.isSafeInteger(id) || id <= 0 || (requested?.[1] && matched?.[1] && requested[1] !== matched[1])) throw invalid()
  const [[order]] = await db.query('SELECT id,warehouse_id FROM purchase_orders WHERE id=?', [id])
  if (!order || Number(order.id) !== id) throw invalid()
  require('../../utils/warehouseScope').assertInScope(scopeWarehouseIds, order.warehouse_id, '采购单')
  if (receipt?.status === 'success' && (receipt.resourceType !== 'purchase_order'
    || Number(receipt.resourceId) !== id || Number(receipt.data?.purchaseOrderId) !== id
    || Number(receipt.data?.status) !== 3 || receipt.data?.closedReason !== 'short_close')) throw invalid()
}

module.exports = { assertPurchaseCloseReceipt }
