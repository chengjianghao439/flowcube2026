const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { ACTION, MATCHED_ACTION, FINGERPRINT, review, conflict, readCreateCandidates, assertCreateFingerprint } = require('./purchase-requisitions.create-intent')
const invalid = () => new AppError('原请购创建结果与单据记录不一致，请核对', 409, 'PURCHASE_REQUISITION_CREATE_RECEIPT_INVALID')
function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
async function assertRequisitionCreateResult(db, receipt, scopeWarehouseIds, { userId, warehouseId = null, lock = false } = {}) {
  const id = positiveId(receipt?.resourceId), data = receipt?.data
  if (receipt?.resourceType !== 'purchase_requisition' || !id || positiveId(data?.id) !== id || typeof data?.requisitionNo !== 'string' || !data.requisitionNo || !positiveId(userId)) throw invalid()
  const [[head]] = await db.query('SELECT id,requisition_no,warehouse_id,applicant_id FROM purchase_requisitions WHERE id=?' + (lock ? ' FOR SHARE' : ''), [id])
  if (positiveId(head?.id) !== id || head.requisition_no !== data.requisitionNo || positiveId(head.applicant_id) !== positiveId(userId) || !positiveId(head.warehouse_id)) throw invalid()
  assertInScope(scopeWarehouseIds, head.warehouse_id, '原请购创建结果')
  if (data.requestFingerprint != null && !positiveId(data.warehouseId)) throw invalid()
  // New receipts also carry their original target, which must remain authorized
  // even if a later permitted draft edit moved the document to another warehouse.
  if (data.warehouseId != null) {
    if (!positiveId(data.warehouseId)) throw invalid()
    assertInScope(scopeWarehouseIds, data.warehouseId, '原请购创建目标仓')
    if (warehouseId != null && positiveId(warehouseId) !== positiveId(data.warehouseId)) throw conflict()
  }
}
async function assertRequisitionCreateReceipt(db, receipt, scopeWarehouseIds, context = {}) {
  if (!MATCHED_ACTION.test(String(context.matchedAction ?? '')) || receipt?.status !== 'success') return
  await assertRequisitionCreateResult(db, receipt, scopeWarehouseIds, { userId: context.requestedUserId, warehouseId: context.requestedWarehouseId })
  if (context.requestedAction !== ACTION || !positiveId(context.requestedWarehouseId) || !FINGERPRINT.test(String(context.requestedFingerprint ?? '')) || !String(context.requestedKey ?? '').trim()) throw review()
  const candidates = await readCreateCandidates(db, { requestKey: context.requestedKey, userId: context.requestedUserId })
  if (candidates.length !== 1) throw review()
  const candidate = candidates[0]
  if (candidate.action !== context.matchedAction || Number(candidate.status) !== 1 || candidate.resource_type !== receipt.resourceType || positiveId(candidate.resource_id) !== positiveId(receipt.resourceId)) throw invalid()
  assertCreateFingerprint(candidate.data?.requestFingerprint, context.requestedFingerprint)
  assertCreateFingerprint(receipt.data?.requestFingerprint, context.requestedFingerprint)
  if (positiveId(receipt.data?.warehouseId) !== positiveId(context.requestedWarehouseId)) throw review()
}
module.exports = { assertRequisitionCreateResult, assertRequisitionCreateReceipt }
