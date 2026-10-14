const AppError = require('../../utils/AppError')
const { assertSaleDocumentInScope } = require('../../utils/saleDocumentScope')

function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 本人原execute结果沿实际命中资源读取，不新增模块VIEW授权。 */
async function assertRefundReceipt(db, receipt, scopeWarehouseIds, receiptContext = {}) {
  const action = String(receiptContext.matchedAction ?? '')
  if (!/^refund\.execute(?:\.[1-9]\d*)?$/.test(action) || receipt?.status !== 'success') return
  const id = positiveId(receipt.resourceId), scoped = /^refund\.execute\.([1-9]\d*)$/.exec(action)
  if (receipt.resourceType !== 'refund_order' || !id
      || positiveId(receipt.data?.id) !== id || (scoped && positiveId(scoped[1]) !== id)) {
    throw new AppError('原退款结果身份不完整，请核对原退款单', 409, 'REFUND_RECEIPT_INVALID')
  }
  const [[refund]] = await db.query('SELECT id, sale_order_id FROM refund_orders WHERE id=?', [id])
  if (positiveId(refund?.id) !== id || !positiveId(refund?.sale_order_id)) throw new AppError('原退款结果关联不存在，请核对原退款单', 409, 'REFUND_RECEIPT_INVALID')
  await assertSaleDocumentInScope(db, scopeWarehouseIds, refund.sale_order_id, { entityName: '退款单' })
}

module.exports = { assertRefundReceipt }
