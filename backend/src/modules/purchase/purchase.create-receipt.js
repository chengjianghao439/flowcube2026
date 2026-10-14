const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')

const CREATE_ACTION = /^purchase\.create(?:\.[a-f0-9]{16})?$/
const invalid = () => new AppError('原创建结果与采购单记录不一致，请联系管理员核对', 409, 'PURCHASE_CREATE_RECEIPT_INVALID')
function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

// POST replay uses the original transaction and a current shared read; public
// receipt lookup stays read-only and does not grant purchase VIEW or write rights.
async function assertPurchaseCreateResult(db, receipt, scopeWarehouseIds, { lock = false } = {}) {
  const id = positiveId(receipt?.resourceId)
  if (receipt?.resourceType !== 'purchase_order' || !id || positiveId(receipt?.data?.id) !== id) throw invalid()
  const [[order]] = await db.query('SELECT id,warehouse_id FROM purchase_orders WHERE id=?' + (lock ? ' FOR SHARE' : ''), [id])
  if (positiveId(order?.id) !== id || !positiveId(order?.warehouse_id)) throw invalid()
  assertInScope(scopeWarehouseIds, order.warehouse_id, '采购单')
}

async function assertPurchaseCreateReceipt(db, receipt, scopeWarehouseIds, context = {}) {
  // The actual matched action protects exact/base and broad-prefix lookups alike.
  // pending/not_found cannot prove a resource; they keep their existing contract.
  if (!CREATE_ACTION.test(String(context.matchedAction ?? '')) || receipt?.status !== 'success') return
  await assertPurchaseCreateResult(db, receipt, scopeWarehouseIds)
}

module.exports = { assertPurchaseCreateResult, assertPurchaseCreateReceipt }
