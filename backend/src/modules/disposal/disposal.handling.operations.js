'use strict'
const AppError = require('../../utils/AppError')
const { stableJson } = require('./disposal.handling.rules')
const conflict = () => new AppError('原操作UUID已有不同身份或载荷，请保留原请求并核对', 409, 'DISPOSAL_HANDLING_OPERATION_CONFLICT')
function assertIdentity(row, identity) {
  if (!row || row.action !== identity.action || Number(row.actor_id) !== identity.userId || row.request_key !== identity.requestKey || row.intent_uuid !== identity.intentUuid
    || row.payload_hash !== identity.payloadHash || row.payload_json !== identity.payloadJson) throw conflict()
}
async function begin(conn, identity) {
  try {
    await conn.query(`INSERT INTO disposal_handling_operations
      (operation_uuid,action,actor_id,request_key,intent_uuid,payload_hash,payload_json,status) VALUES (?,?,?,?,?,?,?,?)`,
    [identity.operationUuid, identity.action, identity.userId, identity.requestKey, identity.intentUuid, identity.payloadHash, identity.payloadJson, 0])
    return null
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error
    // 唯一键等待后的S锁不升级X；当前读成功持久结果，不依赖短期operation_requests。
    const [[row]] = await conn.query('SELECT * FROM disposal_handling_operations WHERE operation_uuid=? FOR SHARE', [identity.operationUuid])
    assertIdentity(row, identity)
    if (Number(row.status) !== 1) throw new AppError('原处理操作仍待确认，请只核对原结果', 409, 'DISPOSAL_HANDLING_OPERATION_PENDING')
    return row
  }
}
async function complete(conn, identity, sourceId, data) {
  const [result] = await conn.query(`UPDATE disposal_handling_operations
    SET source_id=?,resource_type=?,resource_id=?,response_json=?,status=1,completed_at=NOW()
    WHERE operation_uuid=? AND status=0`, [sourceId, 'disposal_handling_source', sourceId, stableJson(data), identity.operationUuid])
  if (result.affectedRows !== 1) throw conflict()
}
async function completeTarget(conn, identity, { sourceId, type, targetId, lineId }, data) {
  const [result] = await conn.query(`UPDATE disposal_handling_operations
    SET source_id=?,target_type=?,target_id=?,target_line_id=?,resource_type=?,resource_id=?,response_json=?,status=1,completed_at=NOW()
    WHERE operation_uuid=? AND status=0`, [sourceId, type, targetId, lineId, type, targetId, stableJson(data), identity.operationUuid])
  if (result.affectedRows !== 1) throw conflict()
}
async function completeRelease(conn, identity, link, data) {
  const [result] = await conn.query(`UPDATE disposal_handling_operations
    SET source_id=?,target_type=?,target_id=?,target_line_id=?,resource_type=?,resource_id=?,response_json=?,status=1,completed_at=NOW()
    WHERE operation_uuid=? AND status=0`, [link.source_id, link.target_type, link.target_id, link.target_line_id, 'disposal_handling_link', link.id, stableJson(data), identity.operationUuid])
  if (result.affectedRows !== 1) throw conflict()
}
async function completeConversion(conn, identity, legacyId, conversionId, data) {
  const [result] = await conn.query(`UPDATE disposal_handling_operations
    SET legacy_disposal_id=?,resource_type=?,resource_id=?,response_json=?,status=1,completed_at=NOW()
    WHERE operation_uuid=? AND status=0`, [legacyId, 'inventory_disposal_conversion', conversionId, stableJson(data), identity.operationUuid])
  if (result.affectedRows !== 1) throw conflict()
}
module.exports = { begin, complete, completeTarget, completeRelease, completeConversion, assertIdentity }
