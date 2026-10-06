'use strict'
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const rules = require('./disposal.handling.rules')
const operations = require('./disposal.handling.operations')
const facts = require('./disposal.handling.facts')
const proof = require('./disposal.handling.proof')
const prefix = 'disposal.handling.link.release.'
function actionLink(action) {
  if (typeof action !== 'string' || !/^disposal\.handling\.link\.release\.[1-9]\d*$/.test(action)) return null
  return rules.safeId(action.slice(prefix.length), '关联ID')
}
function bodyFor(sourceId, linkId, body) {
  if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'expectedRevision,operationUuid,reason' || typeof body.expectedRevision !== 'number'
    || typeof body.reason !== 'string' || !body.reason.trim() || Array.from(body.reason).length > 500) throw new AppError('解除须保留原操作UUID、版本和1–500字说明', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  return { sourceId: rules.safeId(sourceId), linkId: rules.safeId(linkId), operationUuid: rules.uuid(body.operationUuid), expectedRevision: rules.safeId(body.expectedRevision), reason: body.reason }
}
async function sourceAuthorization(conn, source, operator, authorization) {
  if (authorization?.view !== true) throw new AppError('无权查看处理来源', 403, 'PERMISSION_DENIED')
  const legacyId = source.legacy_disposal_id, legacyLineId = source.legacy_disposal_item_id
  if (legacyId == null && legacyLineId == null) {
    if (authorization.create !== true) throw new AppError('无权解除普通处理意图关联', 403, 'PERMISSION_DENIED')
    return
  }
  if (!proof.id(legacyId) || !proof.id(legacyLineId) || authorization.approve !== true) throw new AppError('旧单来源身份或审批权限不完整', 403, 'PERMISSION_DENIED')
  // H5 will create this immutable signed snapshot; H4 cannot manufacture or trust a client origin.
  const [[conversion]] = await conn.query('SELECT * FROM inventory_disposal_conversions WHERE original_disposal_id=?', [legacyId])
  if (!conversion) throw proof.invalid()
  // Immutable identity only: never S/X-lock peer sources after holding this source X.
  const [sources] = await conn.query('SELECT * FROM disposal_handling_sources WHERE legacy_disposal_id=? ORDER BY legacy_disposal_item_id', [legacyId])
  const [[operation]] = await conn.query('SELECT * FROM disposal_handling_operations WHERE operation_uuid=?', [conversion.operation_uuid])
  const { head } = proof.conversionIdentity(source, conversion, operation, sources)
  if (Number(head.operator_id) === Number(operator.userId)) {
    const [[user]] = await conn.query('SELECT allow_self_approve FROM sys_users WHERE id=? AND deleted_at IS NULL', [operator.userId])
    if (Number(user?.allow_self_approve) !== 1) throw new AppError('不能自行解除本人旧审批单来源关联', 403, 'SELF_APPROVAL_DENIED')
  }
}
function assertCurrentIdentity(source, link, context, scope) {
  proof.createIdentity(source, link, context.head, context.operation)
  proof.assertScope(context, scope)
  const parent = proof.metadata(link.target_type).parent
  for (const row of context.lines) {
    if (Number(row.id) !== Number(link.target_line_id) || Number(row[parent]) !== Number(link.target_id) || Number(row.product_id) !== Number(link.product_id) || row.unit !== link.unit || Number(row.warehouse_id ?? context.head.warehouse_id) !== Number(link.warehouse_id)) throw proof.invalid()
  }
  if (context.lines.length > 1) throw proof.invalid()
}
async function readReceipt(conn, operation, scope, { source = null, link = null, contexts = null, currentRead = false } = {}) {
  const linkId = actionLink(operation.action), lock = currentRead ? ' FOR SHARE' : ''
  if (!linkId || operation.resource_type !== 'disposal_handling_link' || Number(operation.resource_id) !== linkId || Number(operation.status) !== 1) throw proof.invalid()
  if (!source) { const [[row]] = await conn.query('SELECT * FROM disposal_handling_sources WHERE id=?' + lock, [operation.source_id]); source = row }
  if (!link) { const [[row]] = await conn.query('SELECT * FROM disposal_handling_links WHERE id=?' + lock, [linkId]); link = row }
  if (!source || !link || Number(link.source_id) !== Number(source.id) || operation.intent_uuid !== source.intent_uuid || Number(operation.source_id) !== Number(source.id)
    || operation.target_type !== link.target_type || Number(operation.target_id) !== Number(link.target_id) || Number(operation.target_line_id) !== Number(link.target_line_id)
    || link.state !== 'TERMINATED' || link.release_operation_uuid !== operation.operation_uuid || link.release_response_json !== operation.response_json || Number(link.released_by) !== Number(operation.actor_id)) throw proof.invalid()
  assertInScope(scope, source.warehouse_id, '处理来源')
  const context = (contexts || await facts.identities(conn, [source], [link])).get(linkId)
  assertCurrentIdentity(source, link, context, scope)
  const frozen = facts.frozen(source, link)
  let payload, result
  try {
    payload = JSON.parse(operation.payload_json); result = JSON.parse(operation.response_json)
    const body = bodyFor(payload.sourceId, payload.linkId, { operationUuid: payload.operationUuid, expectedRevision: payload.expectedRevision, reason: payload.reason })
    if (rules.stableJson(body) !== operation.payload_json || rules.fingerprint(operation.payload_json) !== operation.payload_hash || body.sourceId !== Number(source.id) || body.linkId !== linkId || body.operationUuid !== operation.operation_uuid
      || link.release_reason !== body.reason || Object.keys(result).sort().join(',') !== 'executedQuantity,linkId,releasedQuantity,revision,sourceId' || result.sourceId !== Number(source.id) || result.linkId !== linkId
      || result.executedQuantity !== frozen.executedQuantity || result.releasedQuantity !== frozen.evidence.releasedQuantity || result.revision !== body.expectedRevision + 1) throw proof.invalid()
  } catch { throw proof.invalid() }
  return result
}
async function releaseLink(rawSourceId, rawLinkId, input, { requestKey, operator, authorization, scopeWarehouseIds = null } = {}) {
  const body = bodyFor(rawSourceId, rawLinkId, input), userId = rules.safeId(operator?.userId), key = rules.requestKey(requestKey), conn = await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await conn.beginTransaction()
    const [[source]] = await conn.query('SELECT * FROM disposal_handling_sources WHERE id=? FOR UPDATE', [body.sourceId])
    if (!source || Number(source.id) !== body.sourceId) throw new AppError('处理来源不存在', 404)
    rules.assertSource(source); assertInScope(scopeWarehouseIds, source.warehouse_id, '处理来源')
    await sourceAuthorization(conn, source, operator, authorization)
    const [[peek]] = await conn.query('SELECT * FROM disposal_handling_links WHERE id=?', [body.linkId])
    if (!peek || Number(peek.source_id) !== Number(source.id)) throw proof.invalid()
    const meta = proof.metadata(peek.target_type)
    let prIdentity = null, po = null
    if (peek.target_type === 'purchase_return') {
      ;[[prIdentity]] = await conn.query('SELECT * FROM purchase_returns WHERE id=?', [peek.target_id])
      if (!prIdentity || !proof.id(prIdentity.purchase_order_id)) throw proof.invalid()
      ;[[po]] = await conn.query('SELECT * FROM purchase_orders WHERE id=? FOR SHARE', [prIdentity.purchase_order_id])
      if (!po) throw proof.invalid()
      assertInScope(scopeWarehouseIds, po.warehouse_id, '原采购单')
    }
    const [[head]] = await conn.query(`SELECT * FROM ${meta.head} WHERE id=? FOR UPDATE`, [peek.target_id])
    const [[link]] = await conn.query('SELECT * FROM disposal_handling_links WHERE id=? FOR UPDATE', [body.linkId])
    if (!head || !link || Number(link.source_id) !== Number(source.id) || link.target_type !== peek.target_type || Number(link.target_id) !== Number(peek.target_id)) throw proof.invalid()
    if (po && (Number(head.purchase_order_id) !== Number(prIdentity.purchase_order_id) || Number(po.id) !== Number(head.purchase_order_id) || Number(po.supplier_id) !== Number(head.supplier_id)
      || Number(po.warehouse_id) !== Number(head.warehouse_id) || head.purchase_order_no && head.purchase_order_no !== po.order_no)) throw proof.invalid()
    const contexts = await facts.identities(conn, [source], [link])
    // The locked head is authoritative; no chase-lock when ownership changed.
    contexts.get(Number(link.id)).head = head
    assertCurrentIdentity(source, link, contexts.get(Number(link.id)), scopeWarehouseIds)
    const payloadJson = rules.stableJson(body), identity = { operationUuid: body.operationUuid, action: prefix + link.id, intentUuid: rules.uuid(source.intent_uuid), userId, requestKey: key, payloadJson, payloadHash: rules.fingerprint(payloadJson) }
    const replay = await operations.begin(conn, identity)
    if (replay) { const result = await readReceipt(conn, replay, scopeWarehouseIds, { source, link, contexts, currentRead: true }); await conn.rollback(); return result }
    if (Number(source.revision) !== body.expectedRevision) throw new AppError('处理来源已变化，请重新核对', 409, 'DISPOSAL_HANDLING_REVISION_CHANGED')
    const [allLinks] = await conn.query('SELECT * FROM disposal_handling_links WHERE source_id=? ORDER BY id', [source.id])
    rules.calculateBudget(source, allLinks)
    if (link.state !== 'ACTIVE' || proof.units(link.released_quantity) !== 0 || link.release_operation_uuid != null) throw proof.invalid()
    const result = (await facts.read(conn, [source], [link], { contexts })).get(Number(link.id))
    if (!result.returnClosed || result.executedQuantity == null) throw new AppError(result.pendingReason?.message || '原业务与实物尚未闭合，请先人工核对', 409, 'DISPOSAL_HANDLING_RELEASE_PENDING')
    const response = { sourceId: Number(source.id), linkId: Number(link.id), executedQuantity: result.executedQuantity, releasedQuantity: result.evidence.releasedQuantity, revision: Number(source.revision) + 1 }, responseJson = rules.stableJson(response)
    const [changed] = await conn.query(`UPDATE disposal_handling_links SET released_quantity=?,final_executed_quantity=?,state='TERMINATED',release_operation_uuid=?,released_by=?,released_by_name=?,released_at=NOW(),release_reason=?,release_evidence_json=?,release_response_json=? WHERE id=? AND source_id=? AND state='ACTIVE' AND released_quantity=0 AND release_operation_uuid IS NULL`, [response.releasedQuantity, response.executedQuantity, identity.operationUuid, userId, operator.realName, body.reason, rules.stableJson(result.evidence), responseJson, link.id, source.id])
    if (changed.affectedRows !== 1) throw proof.invalid()
    const [revision] = await conn.query('UPDATE disposal_handling_sources SET revision=revision+1 WHERE id=? AND revision=?', [source.id, source.revision])
    if (revision.affectedRows !== 1) throw proof.invalid()
    await operations.completeRelease(conn, identity, link, response)
    await conn.commit(); return response
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
module.exports = { actionLink, releaseLink, readReceipt, bodyFor }
