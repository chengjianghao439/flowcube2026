'use strict'
const AppError = require('../../utils/AppError')
const { movementLines } = require('./sale.release-batches')
const { jsonObject } = require('../../utils/batch-receipts')
const { assertSaleDocumentInScope } = require('../../utils/saleDocumentScope')
const ordinaryName = action => /^sale\.(reserve|release|ship):/.test(String(action ?? ''))
const invalid = () => { throw new AppError('原销售操作结果与原单不一致，请保留原请求并核对', 409, 'SALE_OPERATION_RECEIPT_INVALID') }
const numericId = value => Number.isSafeInteger(value) && value > 0
const isSupplement = data => numericId(data?.releaseEventId) && numericId(data?.reservationEventId)
  && data.releaseEventId < data.reservationEventId && movementLines(data.reserved) && Object.keys(data).length === 3
const validReserveData = data => data === null || (data && numericId(data.reservationEventId)
  && (Object.keys(data).length === 1 || isSupplement(data)))

async function assertReserveEvent(db, receipt, scopeWarehouseIds) {
  if (receipt.status !== 'success') return
  if (!validReserveData(receipt.data) || receipt.resourceType !== 'sale_order'
    || !Number.isSafeInteger(receipt.resourceId) || receipt.resourceId <= 0) invalid()
  if (receipt.data === null) return
  const [[event]] = await db.query("SELECT id,payload_json FROM sale_order_events WHERE id=? AND sale_order_id=? AND event_type='reserved'",
    [receipt.data.reservationEventId, receipt.resourceId])
  if (Number(event?.id) !== receipt.data.reservationEventId) invalid()
  if (isSupplement(receipt.data)) {
    const payload = jsonObject(event.payload_json)
    if (Number(payload?.supplement?.releaseId) !== receipt.data.releaseEventId
      || JSON.stringify(movementLines(payload?.reserved)) !== JSON.stringify(movementLines(receipt.data.reserved))) invalid()
    if (Array.isArray(scopeWarehouseIds) && receipt.data.reserved.some(row =>
      !scopeWarehouseIds.some(id => Number(id) === Number(row.warehouseId)))) {
      throw new AppError('原补占记录中的发货仓不在当前权限范围', 403, 'WAREHOUSE_SCOPE_DENIED')
    }
  }
}
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
  } else if (match[1] === 'reserve' ? !validReserveData(receipt.data) : receipt.data !== null) invalid()
  // A receipt confirms the original write; it does not reapply fresh-operation eligibility.
  await assertSaleDocumentInScope(db, scopeWarehouseIds, receipt.resourceId, { entityName: '销售操作回执' })
  if (match[1] === 'reserve') await assertReserveEvent(db, receipt, scopeWarehouseIds)
}
module.exports = { assertOrdinarySaleReceipt, assertReserveEvent }
