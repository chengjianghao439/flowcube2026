const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')

const positive = n => Number.isSafeInteger(n) && n > 0
const actionId = action => /^disposal\.dispose(?:\.([1-9]\d*))?$/.exec(String(action || ''))
function invalid() { throw new AppError('报废原结果身份不一致，请保留原请求并人工核对', 409, 'DISPOSAL_RECEIPT_INVALID') }
function assertData(data, id) {
  if (!data || data.id !== id || !positive(id) || typeof data.disposalNo !== 'string' || !data.disposalNo.trim()
    || typeof data.disposedValue !== 'number' || !Number.isFinite(data.disposedValue)) invalid()
}
/** 本人查询只核原处置身份及当前仓范围，不增加查看/执行授权，也不依当前状态猜成功。 */
async function assertDisposalReceipt(conn, receipt, scope, context = {}) {
  const requested = actionId(context.requestedAction), matched = actionId(context.matchedAction)
  const belongs = String(context.requestedAction || '').startsWith('disposal.dispose') || String(context.matchedAction || '').startsWith('disposal.dispose')
  if (!belongs) return
  if (receipt?.status !== 'success') return
  if (!requested || !matched || receipt.resourceType !== 'inventory_disposal' || !positive(receipt.resourceId)) invalid()
  const id = receipt.resourceId
  if ((requested[1] && Number(requested[1]) !== id) || (matched[1] && Number(matched[1]) !== id)) invalid()
  assertData(receipt.data, id)
  // 写事务重放用当前共享读；独立本人查询保持普通只读查询。
  const lock = context.currentRead ? ' FOR SHARE' : ''
  const [[head]] = await conn.query(`SELECT id, warehouse_id, disposal_no FROM inventory_disposal_orders WHERE id=?${lock}`, [id])
  if (!head || !positive(Number(head.warehouse_id)) || head.disposal_no !== receipt.data.disposalNo) invalid()
  assertInScope(scope, head.warehouse_id, '原报废处置单')
}
/** operationRequest 的重放 DTO 不包含资源metadata；从同 conn 当前读核实际存储行。 */
async function replayDisposal(conn, request, id, scope) {
  const [[stored]] = await conn.query('SELECT action, resource_type, resource_id, status, response_json FROM operation_requests WHERE id=? AND user_id <=> ? FOR SHARE', [request.id, request.userId])
  if (!stored || Number(stored.status) !== 1 || stored.action !== request.action) invalid()
  let data
  try { data = JSON.parse(stored.response_json) } catch { invalid() }
  if (data?.id !== id || JSON.stringify(data) !== JSON.stringify(request.responseData)) invalid()
  await assertDisposalReceipt(conn, { status: 'success', resourceType: stored.resource_type, resourceId: Number(stored.resource_id), data }, scope, { requestedAction: `disposal.dispose.${id}`, matchedAction: stored.action, currentRead: true })
  return data
}
module.exports = { assertDisposalReceipt, replayDisposal }
