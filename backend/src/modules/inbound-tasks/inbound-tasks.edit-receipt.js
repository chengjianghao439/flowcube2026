const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const positive = id => Number.isSafeInteger(id) && id > 0
const invalid = () => new AppError('原收货编辑结果身份不一致，请保留原请求并人工核对', 409, 'INBOUND_EDIT_RECEIPT_INVALID')
const actionId = action => /^inbound\.update\.([1-9]\d*)$/.exec(String(action || ''))
function assertData(data, id) {
  if (!data || data.taskId !== id || typeof data.taskNo !== 'string' || !data.taskNo.trim()
    || !/^[a-f0-9]{64}$/.test(data.expectedEditFingerprint || '') || !/^[a-f0-9]{64}$/.test(data.requestFingerprint || '')) throw invalid()
}
const isInboundEditReceipt = context => [context.requestedAction, context.matchedAction].some(action => /^inbound\.update(?:\.|$)/.test(String(action || '')))
/** HTTP本人查询独立要求当前VIEW；UPDATE不能替代，权限撤回按既有middleware即时读取。 */
async function ensureInboundEditReceiptView(req, res, context = {}) {
  if (!isInboundEditReceipt(context)) return
  const { requirePermission } = require('../../middleware/auth')
  const { PERMISSIONS } = require('../../constants/permissions')
  await new Promise((resolve, reject) => requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW)(req, res, error => error ? reject(error) : resolve()))
}
/** 最小回执查询在VIEW门之后核当前原仓，包括not_found；写回放仍沿原UPDATE路由。 */
async function assertInboundEditReceipt(conn, receipt, scopeWarehouseIds, context = {}) {
  if (!isInboundEditReceipt(context)) return
  const requested = actionId(context.requestedAction), matched = context.matchedAction == null ? null : actionId(context.matchedAction)
  if (!requested || !positive(Number(requested[1])) || (context.matchedAction != null && (!matched || Number(matched[1]) !== Number(requested[1])))) throw invalid()
  const id = Number(requested[1])
  const lock = context.currentRead ? ' FOR SHARE' : ''
  const [[head]] = await conn.query(`SELECT id,task_no,warehouse_id FROM inbound_tasks WHERE id = ?${lock}`, [id])
  if (!head || !positive(Number(head.warehouse_id))) throw invalid()
  assertInScope(scopeWarehouseIds, head.warehouse_id, '原收货订单')
  if (receipt?.status !== 'success') return
  if (!matched || receipt.resourceType !== 'inbound_task' || receipt.resourceId !== id) throw invalid()
  assertData(receipt.data, id)
  if (receipt.data.taskNo !== head.task_no) throw invalid()
}
/** 写回放按本人实际operation metadata核对，不能仅凭DTO或当前草稿状态造成功。 */
async function replayInboundEdit(conn, request, id, scopeWarehouseIds) {
  const [[stored]] = await conn.query('SELECT action,resource_type,resource_id,status,response_json FROM operation_requests WHERE id = ? AND user_id <=> ? FOR SHARE', [request.id, request.userId])
  if (!stored || Number(stored.status) !== 1 || stored.action !== `inbound.update.${id}` || stored.action !== request.action) throw invalid()
  let data
  try { data = JSON.parse(stored.response_json) } catch { throw invalid() }
  if (JSON.stringify(data) !== JSON.stringify(request.responseData)) throw invalid()
  await assertInboundEditReceipt(conn, { status: 'success', resourceType: stored.resource_type, resourceId: Number(stored.resource_id), data }, scopeWarehouseIds, { requestedAction: `inbound.update.${id}`, matchedAction: stored.action, currentRead: true })
  return data
}
module.exports = { assertInboundEditReceipt, ensureInboundEditReceiptView, replayInboundEdit }
