'use strict'
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertSqlIdentifier } = require('../../utils/sqlIdentifier')
const rules = require('./disposal.handling.rules')
const TARGETS = Object.freeze({
  sale_order: { handlingType: 1, action: 'disposal.handling.sale.create', head: 'sale_orders', line: 'sale_order_items', parent: 'order_id', number: 'order_no', responseNumber: 'orderNo', path: '/sale/' },
  purchase_return: { handlingType: 2, action: 'disposal.handling.purchase_return.create', head: 'purchase_returns', line: 'purchase_return_items', parent: 'return_id', number: 'return_no', responseNumber: 'returnNo', path: '/returns/purchase/' },
  inventory_disposal: { handlingType: 3, action: 'disposal.handling.scrap.create', head: 'inventory_disposal_orders', line: 'inventory_disposal_items', parent: 'disposal_id', number: 'disposal_no', responseNumber: 'disposalNo', path: '/disposals?detailId=' },
})
const invalid = () => new AppError('关联身份或执行证据不完整，请保留记录人工核对', 409, 'DISPOSAL_HANDLING_FACTS_INVALID')
function metadata(type) {
  const meta = TARGETS[type]
  if (!meta) throw invalid()
  for (const key of ['head', 'line', 'parent', 'number']) assertSqlIdentifier(meta[key], '处理事实静态标识符')
  return meta
}
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
function units(value, positive = false) {
  const n = Number(value), scaled = n * 100
  if (value == null || String(value).trim() === '' || !Number.isFinite(n) || n < 0 || positive && !n || n > 9999999999.99
    || !Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2) throw invalid()
  return Math.round(scaled)
}
function createIdentity(source, link, head, operation) {
  const meta = metadata(link.target_type)
  rules.calculateBudget(source, [link])
  if (!head || !operation || Number(head.id) !== Number(link.target_id) || Number(head.warehouse_id) !== Number(link.warehouse_id)
    || Number(head.disposal_handling_link_id) !== Number(link.id) || link.target_type === 'sale_order' && head.commercial_model != null
    || Number(source.handling_type) !== meta.handlingType || Number(operation.status) !== 1 || operation.action !== meta.action
    || operation.operation_uuid !== link.created_operation_uuid || operation.intent_uuid !== source.intent_uuid
    || Number(operation.source_id) !== Number(source.id) || operation.target_type !== link.target_type || operation.resource_type !== link.target_type
    || Number(operation.target_id) !== Number(link.target_id) || Number(operation.resource_id) !== Number(link.target_id) || Number(operation.target_line_id) !== Number(link.target_line_id)
    || !id(operation.actor_id) || operation.response_json !== link.response_json) throw invalid()
  let body, response
  try {
    rules.uuid(operation.operation_uuid); rules.requestKey(operation.request_key)
    body = JSON.parse(operation.payload_json); response = JSON.parse(operation.response_json)
    const ref = body.disposalSource
    if (!ref || Object.keys(ref).sort().join(',') !== 'expectedRevision,operationUuid,sourceId' || typeof ref.sourceId !== 'number' || typeof ref.expectedRevision !== 'number' || !id(ref.expectedRevision)
      || Number(ref.sourceId) !== Number(source.id) || rules.uuid(ref.operationUuid) !== operation.operation_uuid
      || rules.stableJson(body) !== operation.payload_json || rules.fingerprint(operation.payload_json) !== operation.payload_hash
      || Number(response.id) !== Number(link.target_id) || Object.keys(response).length !== 2 || typeof response[meta.responseNumber] !== 'string' || !response[meta.responseNumber]
      || head[meta.number] !== response[meta.responseNumber]) throw invalid()
  } catch { throw invalid() }
  return { operationUuid: operation.operation_uuid, action: operation.action, actorId: Number(operation.actor_id), requestKey: operation.request_key, payloadHash: operation.payload_hash, payloadJson: operation.payload_json, responseJson: operation.response_json }
}
function assertScope(context, scope) {
  const { head, lines, tasks } = context
  if (!head || !id(head.warehouse_id)) throw invalid()
  assertInScope(scope, head.warehouse_id, '处理关联')
  for (const line of lines) {
    if (!id(line.warehouse_id ?? head.warehouse_id)) throw invalid()
    assertInScope(scope, line.warehouse_id ?? head.warehouse_id, '处理关联')
  }
  for (const task of tasks) {
    if (!id(task.warehouse_id)) throw invalid()
    assertInScope(scope, task.warehouse_id, '处理关联')
  }
}
function sourceIdentity(source) {
  return { id: Number(source.id), intentUuid: source.intent_uuid, productId: Number(source.product_id), warehouseId: Number(source.warehouse_id), unit: source.unit, handlingType: Number(source.handling_type), quantity: Number(source.quantity) }
}
function linkIdentity(link) {
  return { id: Number(link.id), sourceId: Number(link.source_id), targetType: link.target_type, targetId: Number(link.target_id), targetLineId: Number(link.target_line_id), productId: Number(link.product_id), warehouseId: Number(link.warehouse_id), unit: link.unit, allocatedQuantity: units(link.allocated_quantity, true) / 100, createdOperationUuid: link.created_operation_uuid }
}
function conversionIdentity(source, conversion, operation, sources) {
  // Validate frozen protocol only. H5 supplies the full version1 serializer and creates the records.
  const record = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',')
  const canonical = text => { const value = JSON.parse(text); if (rules.stableJson(value) !== text) throw invalid(); return value }
  const headFields = ['id','disposal_no','warehouse_id','warehouse_name','status','total_value','remark','operator_id','operator_name','approved_by','approved_by_name','approved_at','reject_reason','disposed_at','created_at','updated_at','deleted_at','disposal_handling_link_id']
  const itemFields = ['id','disposal_id','product_id','product_code','product_name','unit','quantity','unit_value','dispose_type','remark','created_at']
  const approvalFields = ['approved_by','approved_by_name','approved_at']
  const responseFields = ['id','originalDisposalId','disposalNo','operationUuid','snapshotFingerprint','sources']
  const sourceFields = ['sourceId','intentUuid','legacyItemId','handlingType','productId','warehouseId','unit','quantity','revision']
  try {
    if (!conversion || !operation || !id(conversion.id) || !id(conversion.original_disposal_id) || !id(conversion.signed_by) || typeof conversion.signed_by_name !== 'string'
      || conversion.operation_uuid !== rules.uuid(conversion.operation_uuid) || conversion.operation_uuid !== source.created_operation_uuid
      || Number(conversion.original_disposal_id) !== Number(source.legacy_disposal_id)) throw invalid()
    const head = canonical(conversion.original_head_json), items = canonical(conversion.original_items_json), approval = canonical(conversion.approval_snapshot_json)
    const payload = canonical(conversion.payload_json), response = canonical(conversion.response_json)
    if (!record(head, headFields) || !record(approval, approvalFields) || !Array.isArray(items) || !items.length || !items.some(row => [1,2].includes(Number(row.dispose_type)))
      || Number(head.id) !== Number(conversion.original_disposal_id) || !id(head.warehouse_id) || !id(head.operator_id) || Number(head.status) !== 3 || !id(head.approved_by)
      || typeof head.disposal_no !== 'string' || !head.disposal_no || typeof head.approved_at !== 'string' || !head.approved_at || !Number.isFinite(Date.parse(head.approved_at))
      || head.disposed_at !== null || head.disposal_handling_link_id !== null || approvalFields.some(key => approval[key] !== head[key]) || typeof head.total_value !== 'string' || !/^-?\d+\.\d{4}$/.test(head.total_value)) throw invalid()
    let previous = 0
    for (const item of items) {
      if (!record(item, itemFields) || !id(item.id) || Number(item.id) <= previous || Number(item.disposal_id) !== Number(head.id) || !id(item.product_id)
        || typeof item.product_code !== 'string' || typeof item.product_name !== 'string' || typeof item.unit !== 'string' || !item.unit || ![1,2,3].includes(Number(item.dispose_type))
        || typeof item.quantity !== 'string' || !/^\d+\.\d{2}$/.test(item.quantity) || typeof item.unit_value !== 'string' || !/^-?\d+\.\d{4}$/.test(item.unit_value)) throw invalid()
      units(item.quantity, true); previous = Number(item.id)
    }
    const snapshotFingerprint = rules.fingerprint(rules.stableJson({ version: 1, head, items, approval }))
    if (!record(payload, ['originalDisposalId','operationUuid','snapshotFingerprint','reason']) || !Number.isSafeInteger(payload.originalDisposalId) || payload.originalDisposalId !== Number(head.id)
      || payload.operationUuid !== conversion.operation_uuid || payload.snapshotFingerprint !== snapshotFingerprint || typeof payload.reason !== 'string' || !payload.reason.trim() || Array.from(payload.reason).length > 500
      || conversion.reason !== payload.reason || rules.fingerprint(conversion.payload_json) !== conversion.payload_hash) throw invalid()
    if (Number(operation.status) !== 1 || operation.operation_uuid !== conversion.operation_uuid || operation.action !== `disposal.handling.legacy.convert.${head.id}`
      || Number(operation.actor_id) !== Number(conversion.signed_by) || Number(operation.legacy_disposal_id) !== Number(head.id) || operation.resource_type !== 'inventory_disposal_conversion' || Number(operation.resource_id) !== Number(conversion.id)
      || ['intent_uuid','source_id','target_type','target_id','target_line_id'].some(key => !Object.hasOwn(operation, key) || operation[key] !== null)
      || operation.payload_json !== conversion.payload_json || operation.payload_hash !== conversion.payload_hash || operation.response_json !== conversion.response_json) throw invalid()
    rules.requestKey(operation.request_key)
    if (!record(response, responseFields) || !Number.isSafeInteger(response.id) || response.id !== Number(conversion.id) || !Number.isSafeInteger(response.originalDisposalId) || response.originalDisposalId !== Number(head.id)
      || response.disposalNo !== head.disposal_no || response.operationUuid !== conversion.operation_uuid || response.snapshotFingerprint !== snapshotFingerprint
      || !Array.isArray(response.sources) || response.sources.length !== items.length || !Array.isArray(sources) || sources.length !== items.length) throw invalid()
    const rows = new Map(), intents = new Set()
    for (const row of sources) {
      if (!id(row.id) || rows.has(Number(row.id)) || row.intent_uuid !== rules.uuid(row.intent_uuid) || intents.has(row.intent_uuid)) throw invalid()
      rows.set(Number(row.id), row); intents.add(row.intent_uuid)
    }
    const mapped = new Set()
    for (let index = 0; index < items.length; index++) {
      const item = items[index], data = response.sources[index], row = rows.get(data?.sourceId)
      if (!record(data, sourceFields) || !row || mapped.has(data.sourceId) || !['sourceId','legacyItemId','productId','warehouseId'].every(key => Number.isSafeInteger(data[key]) && data[key] > 0)
        || data.intentUuid !== row.intent_uuid || data.legacyItemId !== Number(item.id) || data.handlingType !== Number(item.dispose_type) || data.productId !== Number(item.product_id) || data.warehouseId !== Number(head.warehouse_id)
        || data.unit !== item.unit || typeof data.quantity !== 'number' || units(data.quantity, true) !== units(item.quantity, true) || data.revision !== 1
        || Number(row.legacy_disposal_id) !== Number(head.id) || Number(row.legacy_disposal_item_id) !== Number(item.id) || Number(row.product_id) !== data.productId || Number(row.warehouse_id) !== data.warehouseId
        || row.product_code !== item.product_code || row.product_name !== item.product_name || row.warehouse_name !== head.warehouse_name || row.unit !== data.unit || Number(row.handling_type) !== data.handlingType || units(row.quantity, true) !== units(data.quantity, true)
        || row.created_operation_uuid !== conversion.operation_uuid || Number(row.created_by) !== Number(conversion.signed_by) || row.created_by_name !== conversion.signed_by_name || row.request_key !== operation.request_key
        || row.payload_hash !== conversion.payload_hash || row.payload_json !== conversion.payload_json || row.response_json !== conversion.response_json) throw invalid()
      mapped.add(data.sourceId)
    }
    if (!rows.has(Number(source.id)) || Number(rows.get(Number(source.id)).legacy_disposal_item_id) !== Number(source.legacy_disposal_item_id)) throw invalid()
    return { head, items, approval, response }
  } catch { throw invalid() }
}
module.exports = { TARGETS, metadata, units, id, invalid, createIdentity, assertScope, sourceIdentity, linkIdentity, conversionIdentity }
