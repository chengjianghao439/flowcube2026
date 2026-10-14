const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { createHash } = require('node:crypto')
const ACTION = /^procurement\.plan\.convert(?:\.([1-9]\d*))?$/
const FINGERPRINT = /^[a-f0-9]{64}$/
const invalid = () => new AppError('原转采购结果与采购计划记录不一致，请联系管理员核对', 409, 'PROCUREMENT_CONVERT_RECEIPT_INVALID')
const conflict = () => new AppError('此请求键已用于另一组采购计划明细，请先核对原操作结果', 409, 'PROCUREMENT_CONVERT_REQUEST_CONFLICT')
function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function convertFingerprint(planId, itemIds, target = 'purchase') {
  const ids = [...new Set(itemIds.map(Number))].sort((a, b) => a - b)
  // Sorted keys match the PC's canonical identity document. Selection order and
  // repeated IDs are irrelevant; a different selected set is a different intent.
  return createHash('sha256').update(JSON.stringify({ itemIds: ids, planId: Number(planId), target })).digest('hex')
}
function bindConvertResult(result, proofIds, requestedFingerprint) {
  const fingerprint = convertFingerprint(result.planId, proofIds)
  if (result.requestFingerprint != null && (!FINGERPRINT.test(String(result.requestFingerprint)) || result.requestFingerprint !== fingerprint)) throw invalid()
  if (!FINGERPRINT.test(String(requestedFingerprint ?? '')) || requestedFingerprint !== fingerprint) throw conflict()
  // The legacy selected set is proven by immutable CONVERTED PI links and the
  // full original PO groups. Derive only in this response; do not rewrite history.
  return { ...result, requestFingerprint: fingerprint }
}

// Check the original conversion's groups, not unrelated/unconverted plan rows
// or the present request's selection. Scope is always checked before body binding.
async function assertConvertResult(db, receipt, scopeWarehouseIds, { planId = null, lock = false } = {}) {
  const id = positiveId(receipt?.resourceId), result = receipt?.data
  if (receipt?.resourceType !== 'procurement_plan' || !id || positiveId(result?.planId) !== id || (planId != null && positiveId(planId) !== id) || ![2, 3].includes(Number(result?.planStatus)) || !Array.isArray(result?.createdOrders) || !result.createdOrders.length) throw invalid()
  const groups = new Map()
  for (const group of result.createdOrders) {
    const poId = positiveId(group?.purchaseOrderId)
    if (!poId || groups.has(poId) || !positiveId(group.warehouseId) || !positiveId(group.supplierId) || !positiveId(group.itemCount) || typeof group.orderNo !== 'string' || !group.orderNo) throw invalid()
    assertInScope(scopeWarehouseIds, group.warehouseId, '原转采购结果')
    groups.set(poId, group)
  }
  const readLock = lock ? ' FOR SHARE' : ''
  const [[plan]] = await db.query('SELECT id FROM procurement_plans WHERE id=?' + readLock, [id])
  if (positiveId(plan?.id) !== id) throw invalid()
  const poIds = [...groups.keys()].sort((a, b) => a - b)
  const [sourceItems] = await db.query('SELECT id,plan_id,warehouse_id,supplier_id,status,purchase_order_id FROM procurement_plan_items WHERE plan_id=? AND purchase_order_id IN (?) ORDER BY id' + readLock, [id, poIds])
  const counts = new Map(poIds.map(poId => [poId, 0])), seen = new Set()
  for (const item of sourceItems) {
    const itemId = positiveId(item.id), poId = positiveId(item.purchase_order_id), group = groups.get(poId)
    if (!positiveId(item.warehouse_id)) throw invalid()
    assertInScope(scopeWarehouseIds, item.warehouse_id, '原转换明细')
    if (!itemId || seen.has(itemId) || !group || positiveId(item.plan_id) !== id || Number(item.status) !== 2 || positiveId(item.warehouse_id) !== positiveId(group.warehouseId) || positiveId(item.supplier_id) !== positiveId(group.supplierId)) throw invalid()
    seen.add(itemId); counts.set(poId, counts.get(poId) + 1)
  }
  for (const [poId, group] of groups) {
    if (counts.get(poId) !== Number(group.itemCount)) throw invalid()
  }
  const [orders] = await db.query('SELECT id,order_no,warehouse_id FROM purchase_orders WHERE id IN (?) ORDER BY id' + readLock, [poIds])
  const found = new Set()
  for (const order of orders) {
    const poId = positiveId(order.id), group = groups.get(poId)
    if (!group || found.has(poId) || order.order_no !== group.orderNo || !positiveId(order.warehouse_id)) throw invalid()
    assertInScope(scopeWarehouseIds, order.warehouse_id, '原转换采购单')
    found.add(poId)
  }
  if (found.size !== groups.size) throw invalid()
  return [...seen].sort((a, b) => a - b)
}

async function assertConvertReceipt(db, receipt, scopeWarehouseIds, context = {}) {
  const match = ACTION.exec(String(context.matchedAction ?? ''))
  if (!match || receipt?.status !== 'success') return
  const proofIds = await assertConvertResult(db, receipt, scopeWarehouseIds, { planId: match[1] ?? null })
  if (context.requestedFingerprint != null) {
    if (context.requestedAction !== `procurement.plan.convert.${positiveId(receipt.resourceId)}`) throw conflict()
    receipt.data = bindConvertResult(receipt.data, proofIds, context.requestedFingerprint)
  }
}
module.exports = { assertConvertResult, assertConvertReceipt, convertFingerprint, bindConvertResult }
