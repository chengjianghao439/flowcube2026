'use strict'
const AppError = require('../../utils/AppError')
const { assertSaleDocumentInScope } = require('../../utils/saleDocumentScope')
const ordinaryName = action => /^sale\.(reserve|release|ship):/.test(String(action ?? ''))
const invalid = () => { throw new AppError('原销售操作结果与原单不一致，请保留原请求并核对', 409, 'SALE_OPERATION_RECEIPT_INVALID') }
async function assertOrdinarySaleReceipt(db, receipt, scopeWarehouseIds, context = {}) {
  // Existing ordinary actions use a colon; Kit actions keep their separate dotted contract.
  if (!ordinaryName(context.matchedAction) || receipt.status !== 'success') return
  const match = /^sale\.(reserve|release|ship):([1-9]\d*)$/.exec(context.matchedAction)
  if (!match || !Number.isSafeInteger(Number(match[2])) || receipt.resourceType !== 'sale_order'
    || !Number.isSafeInteger(receipt.resourceId) || receipt.resourceId !== Number(match[2])) invalid()
  if (ordinaryName(context.requestedAction) && context.requestedAction !== context.matchedAction) invalid()
  if (match[1] === 'ship') {
    const result = receipt.data
    if (!result || !Array.isArray(result.tasks) || !result.tasks.length || typeof result.partial !== 'boolean'
      || !Number.isSafeInteger(result.remaining) || result.remaining < 0 || result.partial !== (result.remaining > 0)) invalid()
    const ids = new Set()
    for (const task of result.tasks) {
      if (!task || !Number.isSafeInteger(task.taskId) || task.taskId <= 0 || ids.has(task.taskId)
        || typeof task.taskNo !== 'string' || !task.taskNo.trim() || typeof task.warehouseName !== 'string') invalid()
      ids.add(task.taskId)
    }
  } else if (receipt.data !== null) invalid()
  // A receipt confirms the original write; it does not reapply fresh-operation eligibility.
  await assertSaleDocumentInScope(db, scopeWarehouseIds, receipt.resourceId, { entityName: '销售操作回执' })
}
module.exports = { assertOrdinarySaleReceipt }
