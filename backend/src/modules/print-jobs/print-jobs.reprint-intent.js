const crypto = require('crypto')
const AppError = require('../../utils/AppError')
const { assertBoundWarehouseInScope } = require('../../utils/warehouseScope')
const { beginResourceOperationRequest, completeOperationRequest, stableStringify } = require('../../utils/operationRequest')
const { assertContainerReprintSource, readContainerReprintSources, identity } = require('./print-jobs.reprint-source')
const invalid = () => new AppError('原补打结果身份不一致，请保留原请求并核对', 409, 'PRINT_REPRINT_RECEIPT_INVALID')
async function beginReprintIntent(conn, { requestKey, userId, action, resourceId, payload, scopeWarehouseIds, sourceIdentities = [] }) {
  if (typeof requestKey !== 'string' || !requestKey.trim() || requestKey.trim().length > 80) throw new AppError('补打必须提供有效请求键', 400, 'REQUEST_KEY_REQUIRED')
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new AppError('补打操作人无效', 403)
  const fingerprint = crypto.createHash('sha256').update(stableStringify(payload)).digest('hex')
  const request = await beginResourceOperationRequest(conn, { requestKey, action, resourceId, userId })
  if (request.replay) {
    const receipt = request.responseData
    if (!receipt || receipt.version !== 1 || receipt.resourceId !== Number(resourceId) || receipt.action !== request.action || !Array.isArray(receipt.warehouseIds) || !receipt.result) throw invalid()
    if (receipt.fingerprint !== fingerprint) throw new AppError('同一补打请求键的正文已变化，请核对原提交结果', 409, 'PRINT_REPRINT_REQUEST_CONFLICT')
    if (receipt.sourceIdentities && receipt.sourceIdentities.some(original => !sourceIdentities.some(current => stableStringify(current) === stableStringify(original)))) throw invalid()
    for (const id of receipt.warehouseIds) assertBoundWarehouseInScope(scopeWarehouseIds, id, '原补打结果')
    return { ...request, result: receipt.result, receipt }
  }
  // 已存在回执可读旧键；回执已清理时，键内时间阻止将旧未知意图重新入队。
  const match = /^reprint-v2-(\d{13})-[\w-]+$/.exec(requestKey.trim())
  if (!match) throw new AppError('原补打意图时间无法确认，请先查询原结果；另补须明确新意图', 409, 'PRINT_REPRINT_INTENT_UNKNOWN')
  const age = Date.now() - Number(match[1])
  if (age < -60000 || age >= 7 * 86400000 - 120000) throw new AppError('原补打意图已过期或时间异常，禁止按旧意图重建；请核对后明确另补一份', 409, 'PRINT_REPRINT_INTENT_EXPIRED')
  return { ...request, fingerprint, sourceIdentities }
}
async function completeReprintIntent(conn, request, { resourceId, warehouseIds, result }) {
  const receipt = { version: 1, action: request.action, resourceId: Number(resourceId), fingerprint: request.fingerprint, sourceIdentities: request.sourceIdentities, warehouseIds: [...new Set(warehouseIds.map(id => id == null ? null : Number(id)))], result }
  await completeOperationRequest(conn, request, { data: receipt, resourceType: 'print_reprint', resourceId })
  return result
}
function actionMatch(action) { return /^(print\.barcodeReprint|inbound\.reprint)(?:\.([1-9]\d*))?$/.exec(String(action || '')) }
async function ensureReprintReceiptPermission(req, res, context = {}) {
  const match = actionMatch(context.matchedAction) || actionMatch(context.requestedAction)
  if (!match) return
  const { requirePermission } = require('../../middleware/auth')
  const { PERMISSIONS } = require('../../constants/permissions')
  const permission = match[1] === 'inbound.reprint' ? PERMISSIONS.INBOUND_PRINT_REPRINT : PERMISSIONS.PRINT_JOB_REPRINT
  await new Promise((resolve, reject) => requirePermission(permission)(req, res, error => error ? reject(error) : resolve()))
}
async function assertReprintReceiptScope(conn, receipt, scopeWarehouseIds, context = {}) {
  const match = actionMatch(context.matchedAction) || actionMatch(context.requestedAction)
  if (!match || receipt?.status !== 'success') return
  const data = receipt.data
  if (!data || data.version !== 1 || data.action !== context.matchedAction || receipt.resourceType !== 'print_reprint' || Number(receipt.resourceId) !== data.resourceId || (match[2] && Number(match[2]) !== data.resourceId) || !Array.isArray(data.warehouseIds)) throw invalid()
  for (const id of data.warehouseIds) assertBoundWarehouseInScope(scopeWarehouseIds, id, '原补打结果')
  let rows
  if (match[1] === 'inbound.reprint') {
    ;[rows] = await conn.query('SELECT warehouse_id FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL', [data.resourceId])
    if (rows.length !== 1 || data.result?.taskId !== data.resourceId || !Array.isArray(data.result.containerIds) || !data.result.containerIds.length || data.result.containerIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw invalid()
    const containers = await readContainerReprintSources(conn, data.result.containerIds)
    for (const container of containers) {
      assertContainerReprintSource(container, scopeWarehouseIds)
      if (Number(container.inbound_task_id) !== data.resourceId) throw invalid()
    }
    if (data.sourceIdentities && stableStringify(containers.map(identity)) !== stableStringify(data.sourceIdentities)) throw invalid()
    if (containers.length !== data.result.containerIds?.length) throw invalid()
    rows.push(...containers)
  } else if (data.result.category === 'inbound') {
    ;rows = await readContainerReprintSources(conn, [data.resourceId])
    for (const row of rows) assertContainerReprintSource(row, scopeWarehouseIds)
    if (data.sourceIdentities && stableStringify(rows.map(identity)) !== stableStringify(data.sourceIdentities)) throw invalid()
  } else if (data.result.category === 'outbound') {
    ;[rows] = await conn.query('SELECT wt.warehouse_id FROM packages p JOIN warehouse_tasks wt ON wt.id=p.warehouse_task_id WHERE p.id=?', [data.resourceId])
  } else if (data.result.category === 'logistics') {
    ;[rows] = await conn.query('SELECT warehouse_id FROM print_jobs WHERE id = ?', [data.resourceId])
  } else throw invalid()
  if (!rows.length) throw invalid()
  for (const row of rows) assertBoundWarehouseInScope(scopeWarehouseIds, row.warehouse_id, '原补打来源')
}
module.exports = { beginReprintIntent, completeReprintIntent, ensureReprintReceiptPermission, assertReprintReceiptScope }
