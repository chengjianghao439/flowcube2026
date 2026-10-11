const AppError = require('../../utils/AppError')
const { requestFingerprint } = require('./inbound-tasks.edit-rules')
const ACTION = 'inbound.create'
const positive = value => Number.isSafeInteger(value) && value > 0
const invalid = () => new AppError('原收货创建结果身份不一致，请保留原请求并人工核对', 409, 'INBOUND_CREATE_RECEIPT_INVALID')
const isInboundCreateReceipt = context => [context.requestedAction, context.matchedAction].some(action => /^inbound\.create(?:\.|$)/.test(String(action || '')))
/** 同键正文绑定采用既有唯一键锁；不改变共享创建帮助函数的其他领域语义。 */
async function beginInboundCreate(conn, body, { requestKey = null, userId = null } = {}) {
  if (requestKey == null) return { enabled: false } // 旧客户端/内部调用兼容，无键不能宣称幂等。
  if (typeof requestKey !== 'string' || !requestKey.trim() || requestKey.trim().length > 100) throw new AppError('创建收货必须携带有效的原请求键', 400, 'REQUEST_KEY_REQUIRED')
  if (!positive(Number(userId))) throw new AppError('登录身份无效', 401)
  const fingerprint = requestFingerprint(body)
  const { beginOperationRequest } = require('../../utils/operationRequest')
  return { ...await beginOperationRequest(conn, { requestKey: requestKey.trim(), action: ACTION, userId: Number(userId) }), fingerprint }
}
async function ensureInboundCreateReceiptView(req, res, context = {}) {
  if (!isInboundCreateReceipt(context)) return
  const { requirePermission } = require('../../middleware/auth')
  const { PERMISSIONS } = require('../../constants/permissions')
  await new Promise((resolve, reject) => requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW)(req, res, error => error ? reject(error) : resolve()))
}
/** 查询不读当前来源/数量；先按原请求仓授权，成功再核实际单据与回执。 */
async function assertInboundCreateReceipt(conn, receipt, scopeWarehouseIds, context = {}) {
  if (!isInboundCreateReceipt(context)) return
  const warehouseId = Number(context.requestedWarehouseId), fingerprint = context.requestedFingerprint
  if (context.requestedAction !== ACTION || !positive(warehouseId) || !/^[a-f0-9]{64}$/.test(fingerprint || '') || context.matchedAction != null && context.matchedAction !== ACTION) throw invalid()
  const { assertInScope } = require('../../utils/warehouseScope')
  assertInScope(scopeWarehouseIds, warehouseId, '原收货创建仓库')
  if (receipt?.status !== 'success') return
  if (context.matchedAction !== ACTION) throw invalid()
  const data = receipt.data
  if (!data || !positive(data.taskId) || typeof data.taskNo !== 'string' || !data.taskNo.trim() || data.warehouseId !== warehouseId || data.requestFingerprint !== fingerprint
    || receipt.resourceType !== 'inbound_task' || receipt.resourceId !== data.taskId) throw invalid()
  const lock = context.currentRead ? ' FOR SHARE' : ''
  const [[head]] = await conn.query(`SELECT id,task_no,warehouse_id FROM inbound_tasks WHERE id = ?${lock}`, [data.taskId])
  if (!head || Number(head.id) !== data.taskId || head.task_no !== data.taskNo || Number(head.warehouse_id) !== warehouseId) throw invalid()
  assertInScope(scopeWarehouseIds, Number(head.warehouse_id), '原收货订单')
}
async function replayInboundCreate(conn, request, scopeWarehouseIds) {
  if (request.responseData?.requestFingerprint !== request.fingerprint) throw new AppError('原请求键对应的创建内容不同，请保留原请求并核对', 409, 'INBOUND_CREATE_REQUEST_CONFLICT')
  const [[stored]] = await conn.query('SELECT action,resource_type,resource_id,status,response_json FROM operation_requests WHERE id = ? AND user_id <=> ? FOR SHARE', [request.id, request.userId])
  if (!stored || stored.action !== ACTION || request.action !== ACTION || Number(stored.status) !== 1) throw invalid()
  let data
  try { data = JSON.parse(stored.response_json) } catch { throw invalid() }
  if (JSON.stringify(data) !== JSON.stringify(request.responseData)) throw invalid()
  await assertInboundCreateReceipt(conn, { status: 'success', resourceType: stored.resource_type, resourceId: Number(stored.resource_id), data }, scopeWarehouseIds,
    { requestedAction: ACTION, matchedAction: stored.action, requestedWarehouseId: data.warehouseId, requestedFingerprint: request.fingerprint, currentRead: true })
  return data
}
module.exports = { beginInboundCreate, replayInboundCreate, ensureInboundCreateReceiptView, assertInboundCreateReceipt }
