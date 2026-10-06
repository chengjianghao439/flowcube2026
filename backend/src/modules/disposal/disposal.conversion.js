'use strict'
const crypto = require('node:crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const rules = require('./disposal.handling.rules')
const operations = require('./disposal.handling.operations')
const proof = require('./disposal.handling.proof')
const snapshot = require('./disposal.conversion.snapshot')
const prefix = 'disposal.handling.legacy.convert.'
function actionId(action) {
  if (typeof action !== 'string' || !/^disposal\.handling\.legacy\.convert\.[1-9]\d*$/.test(action)) return null
  return rules.safeId(action.slice(prefix.length), '原处置单ID')
}
function bodyFor(rawId, input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'operationUuid,reason,snapshotFingerprint' || typeof input.snapshotFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.snapshotFingerprint)
    || typeof input.reason !== 'string' || !input.reason.trim() || Array.from(input.reason).length > 500) throw new AppError('请保留原操作UUID、原依据指纹及1–500字签认说明', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  return { originalDisposalId: rules.safeId(rawId), operationUuid: rules.uuid(input.operationUuid), snapshotFingerprint: input.snapshotFingerprint, reason: input.reason }
}
function assertHeadScope(head, id, scope) {
  if (!head || Number(head.id) !== id || !proof.id(head.warehouse_id)) throw new AppError('原处置单不存在或身份不完整', 409, 'DISPOSAL_CONVERSION_SNAPSHOT_INVALID')
  assertInScope(scope, head.warehouse_id, '原处置单')
}
async function readReceipt(conn, operation, scope, { currentHead = null, currentRead = false } = {}) {
  const id = actionId(operation?.action)
  if (!id || Number(operation.status) !== 1 || Number(operation.legacy_disposal_id) !== id) throw proof.invalid()
  if (!currentHead) { const [[row]] = await conn.query('SELECT * FROM inventory_disposal_orders WHERE id=?' + (currentRead ? ' FOR SHARE' : ''), [id]); currentHead = row }
  assertHeadScope(currentHead, id, scope)
  const [[conversion]] = await conn.query('SELECT * FROM inventory_disposal_conversions WHERE original_disposal_id=?' + (currentRead ? ' FOR SHARE' : ''), [id])
  // Peer source identity is immutable; no peer S/X locks, no revision/current-budget comparison.
  const [sources] = await conn.query('SELECT * FROM disposal_handling_sources WHERE legacy_disposal_id=? ORDER BY legacy_disposal_item_id', [id])
  if (!sources.length) throw proof.invalid()
  const { head, response } = proof.conversionIdentity(sources[0], conversion, operation, sources)
  if (currentHead.disposal_no !== head.disposal_no || Number(currentHead.warehouse_id) !== Number(head.warehouse_id) || currentHead.disposal_handling_link_id !== null) throw proof.invalid()
  for (const source of sources) assertInScope(scope, source.warehouse_id, '原签认来源')
  return response
}
async function preview(rawId, scope = null) {
  const id = rules.safeId(rawId), conn = await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION READ ONLY')
    const [[head]] = await conn.query('SELECT * FROM inventory_disposal_orders WHERE id=?', [id])
    assertHeadScope(head, id, scope)
    const [items] = await conn.query('SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id', [id])
    const full = snapshot.serialize(head, items)
    const [[converted]] = await conn.query('SELECT * FROM inventory_disposal_conversions WHERE original_disposal_id=?', [id])
    const result = { snapshot: full, snapshotFingerprint: rules.fingerprint(rules.stableJson(full)), conversion: converted ? { id: rules.safeId(converted.id), originalDisposalId: id, operationUuid: rules.uuid(converted.operation_uuid) } : null }
    await conn.commit(); return result
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
function validateSnapshot(full) {
  const { head, items } = full
  if (Number(head.status) !== 3 || head.disposed_at !== null || head.disposal_handling_link_id !== null || !proof.id(head.operator_id) || !proof.id(head.approved_by) || !head.approved_at
    || typeof head.disposal_no !== 'string' || !head.disposal_no || typeof head.warehouse_name !== 'string' || !head.warehouse_name || Array.from(head.warehouse_name).length > 100
    || !items.length || !items.some(row => [1,2].includes(Number(row.dispose_type)))) throw proof.invalid()
  let previous = 0
  for (const row of items) {
    if (!proof.id(row.id) || Number(row.id) <= previous || Number(row.disposal_id) !== Number(head.id) || !proof.id(row.product_id) || ![1,2,3].includes(Number(row.dispose_type))
      || [[row.product_code,50],[row.product_name,150],[row.unit,20]].some(([value,max]) => typeof value !== 'string' || !value.trim() || Array.from(value).length > max)) throw proof.invalid()
    proof.units(row.quantity, true); previous = Number(row.id)
  }
}
async function sign(rawId, input, { requestKey, operator, authorization, scopeWarehouseIds = null } = {}) {
  const body = bodyFor(rawId, input), actor = rules.safeId(operator?.userId), key = rules.requestKey(requestKey)
  if (authorization?.view !== true || authorization?.approve !== true) throw new AppError('签认须有原处置查看与审批权限', 403, 'PERMISSION_DENIED')
  if (typeof operator.realName !== 'string' || !operator.realName.trim() || Array.from(operator.realName).length > 50) throw proof.invalid()
  const payloadJson = rules.stableJson(body), identity = { operationUuid: body.operationUuid, action: prefix + body.originalDisposalId, intentUuid: null, userId: actor, requestKey: key, payloadJson, payloadHash: rules.fingerprint(payloadJson) }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[head]] = await conn.query('SELECT * FROM inventory_disposal_orders WHERE id=? FOR UPDATE', [body.originalDisposalId])
    assertHeadScope(head, body.originalDisposalId, scopeWarehouseIds)
    const [items] = await conn.query('SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id FOR UPDATE', [body.originalDisposalId])
    const [[user]] = await conn.query('SELECT id,allow_self_approve FROM sys_users WHERE id=? FOR SHARE', [actor])
    if (!user || Number(user.id) !== actor) throw proof.invalid()
    if (Number(head.operator_id) === actor && Number(user.allow_self_approve) !== 1) throw new AppError('不能自行签认本人旧处置单', 403, 'SELF_APPROVAL_DENIED')
    const replay = await operations.begin(conn, identity)
    if (replay) { const result = await readReceipt(conn, replay, scopeWarehouseIds, { currentHead: head, currentRead: true }); await conn.rollback(); return result }
    const [[existing]] = await conn.query('SELECT * FROM inventory_disposal_conversions WHERE original_disposal_id=? FOR SHARE', [body.originalDisposalId])
    if (existing) throw new AppError('旧整单已签认，不可另开来源预算，请核对原操作', 409, 'DISPOSAL_ALREADY_CONVERTED')
    const full = snapshot.serialize(head, items)
    if (rules.fingerprint(rules.stableJson(full)) !== body.snapshotFingerprint) throw new AppError('原整单依据已变化，请保留原预览并人工核对', 409, 'DISPOSAL_CONVERSION_SNAPSHOT_CHANGED')
    validateSnapshot(full)
    // All candidates by exact domain identity/number; no move/SKU/warehouse filter hides dirty evidence.
    const [logs] = await conn.query('SELECT * FROM inventory_logs WHERE (ref_type=? AND ref_id=?) OR (log_source_type=? AND log_source_ref_id=?) OR ref_no=?', ['disposal', body.originalDisposalId, 'disposal', body.originalDisposalId, head.disposal_no])
    const [scrapped] = await conn.query('SELECT * FROM disposal_scrapped WHERE disposal_id=? OR disposal_no=?', [body.originalDisposalId, head.disposal_no])
    if (logs.length || scrapped.length) throw new AppError('旧单存在实物执行痕迹，请人工核对，不能签认', 409, 'DISPOSAL_CONVERSION_EXECUTION_FOUND')
    const [[warehouse]] = await conn.query('SELECT id,code FROM inventory_warehouses WHERE id=? FOR SHARE', [head.warehouse_id])
    const productIds = [...new Set(items.map(row => Number(row.product_id)))].sort((a,b) => a-b)
    const [products] = await conn.query('SELECT id FROM product_items WHERE id IN (?) ORDER BY id FOR SHARE', [productIds])
    if (!warehouse || Number(warehouse.id) !== Number(head.warehouse_id) || typeof warehouse.code !== 'string' || !warehouse.code.trim() || Array.from(warehouse.code).length > 30
      || products.length !== productIds.length || products.some((row,index) => Number(row.id) !== productIds[index])) throw new AppError('历史商品或仓库父档已物理缺失，整单不可签认', 409, 'DISPOSAL_CONVERSION_PARENT_MISSING')
    const [inserted] = await conn.query(`INSERT INTO inventory_disposal_conversions
      (original_disposal_id,original_head_json,original_items_json,approval_snapshot_json,signed_by,signed_by_name,reason,payload_hash,operation_uuid,payload_json,response_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [body.originalDisposalId, rules.stableJson(full.head), rules.stableJson(full.items), rules.stableJson(full.approval), actor, operator.realName, body.reason, identity.payloadHash, identity.operationUuid, payloadJson, 'null'])
    const conversionId = rules.safeId(inserted.insertId)
    const values = full.items.map(row => [crypto.randomUUID(), identity.operationUuid, row.product_id, row.product_code, row.product_name, head.warehouse_id, warehouse.code, head.warehouse_name, row.unit, row.dispose_type, row.quantity, actor, operator.realName, key, identity.payloadHash, payloadJson, 1, body.originalDisposalId, row.id])
    if (!values.length) throw proof.invalid()
    await conn.query(`INSERT INTO disposal_handling_sources
      (intent_uuid,created_operation_uuid,product_id,product_code,product_name,warehouse_id,warehouse_code,warehouse_name,unit,handling_type,quantity,created_by,created_by_name,request_key,payload_hash,payload_json,revision,legacy_disposal_id,legacy_disposal_item_id) VALUES ?`, [values])
    const [sources] = await conn.query('SELECT * FROM disposal_handling_sources WHERE legacy_disposal_id=? AND created_operation_uuid=? ORDER BY legacy_disposal_item_id', [body.originalDisposalId, identity.operationUuid])
    if (sources.length !== full.items.length || sources.some((row,index) => Number(row.legacy_disposal_item_id) !== Number(full.items[index].id))) throw proof.invalid()
    const result = { id: conversionId, originalDisposalId: body.originalDisposalId, disposalNo: head.disposal_no, operationUuid: identity.operationUuid, snapshotFingerprint: body.snapshotFingerprint, sources: sources.map(row => ({ sourceId: rules.safeId(row.id), intentUuid: rules.uuid(row.intent_uuid), legacyItemId: Number(row.legacy_disposal_item_id), handlingType: Number(row.handling_type), productId: Number(row.product_id), warehouseId: Number(row.warehouse_id), unit: row.unit, quantity: Number(row.quantity), revision: 1 })) }
    const responseJson = rules.stableJson(result)
    const [savedSources] = await conn.query('UPDATE disposal_handling_sources SET response_json=? WHERE legacy_disposal_id=? AND created_operation_uuid=?', [responseJson, body.originalDisposalId, identity.operationUuid])
    const [savedConversion] = await conn.query('UPDATE inventory_disposal_conversions SET response_json=? WHERE id=? AND operation_uuid=?', [responseJson, conversionId, identity.operationUuid])
    if (savedSources.affectedRows !== full.items.length || savedConversion.affectedRows !== 1) throw proof.invalid()
    await operations.completeConversion(conn, identity, body.originalDisposalId, conversionId, result)
    // Validate the entire persisted protocol, including all read-back IDs, before the one commit.
    const [[completed]] = await conn.query('SELECT * FROM disposal_handling_operations WHERE operation_uuid=? FOR SHARE', [identity.operationUuid])
    await readReceipt(conn, completed, scopeWarehouseIds, { currentHead: head, currentRead: true })
    await conn.commit(); return result
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
module.exports = { actionId, preview, sign, readReceipt }
