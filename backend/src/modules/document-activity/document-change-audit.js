const { randomUUID } = require('node:crypto')
const AppError = require('../../utils/AppError')
const { creationFingerprint } = require('../../utils/operationRequest')

function normalizeReason(value) {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > 500) throw new AppError('变更原因最多 500 个字符', 400, 'CHANGE_REASON_INVALID')
  return value.trim() || null
}
const fixed = (value, scale) => value == null ? null : Number(value).toFixed(scale)
const actor = (value, role) => ({ id: value?.userId ?? value?.operatorId ?? value?.id ?? null, name: value?.realName || value?.operatorName || value?.name || value?.username || null, role })
function canonicalLine(row, defaultWarehouseId = null) {
  const group = row.lineKey != null
  const basePrice = row.unit_price ?? row.unitPrice ?? row.salePrice ?? row.sale_price
  const rate = row.conversionRate ?? row.conversion_rate ?? row.metadata?.entry?.conversionRate ?? null
  const originalEntryQty = row.entryQty ?? row.entry_qty ?? row.metadata?.entry?.entryQty ?? null
  const currentEntryQty = group && row.kind === 'ordinary' && Number(rate) > 0 ? Number(row.targetQty) / Number(rate) : null
  const exactEntryQty = currentEntryQty != null && Math.abs(currentEntryQty * 100 - Math.round(currentEntryQty * 100)) < 1e-7 ? fixed(currentEntryQty,2) : null
  return {
    kind: group ? row.kind : 'physical',
    sourceItemId: row.id == null ? null : Number(row.id),
    productId: row.productId ?? row.product_id ?? null,
    productCode: row.productCode ?? row.product_code ?? row.kitCode ?? null,
    productName: row.productName ?? row.product_name ?? row.kitName ?? null,
    warehouseId: row.warehouseId ?? row.warehouse_id ?? defaultWarehouseId,
    quantity: fixed(group ? row.targetQty : row.quantity, 2),
    unitPrice: fixed(basePrice, 4),
    baseUnitPriceExact: basePrice == null ? null : String(basePrice),
    entryUnitPrice: basePrice != null && Number(rate) > 0 ? fixed(Number(basePrice) * Number(rate),4) : row.metadata?.entry?.entryUnitPrice != null ? fixed(row.metadata.entry.entryUnitPrice,4) : null,
    amount: fixed(row.amount ?? row.grossAmount, 4),
    unit: row.unit ?? (row.kind === 'kit' ? '套' : row.components?.[0]?.unit ?? null),
    entryUnit: row.entryUnit ?? row.entry_unit ?? row.metadata?.entry?.entryUnit ?? null,
    entryQty: group && row.kind === 'ordinary' ? exactEntryQty : fixed(originalEntryQty,2),
    entryQtyBasis: group && row.kind === 'ordinary' ? 'current_conversion' : 'stored_entry',
    originalEntryQty: group && row.kind === 'ordinary' ? fixed(originalEntryQty,2) : null,
    conversionRate: rate == null ? null : Number(rate),
    kitVersionId: row.kitVersionId ?? null,
    snapshotRevision: row.snapshotRevision ?? null,
    components: group ? (row.components || []).map(c => ({ productId: c.productId, productCode: c.productCode, productName: c.productName, unit: c.unit, baseQty: fixed(c.baseQty, 2), requiredQty: fixed(row.kind === 'kit' ? Number(c.baseQty) * Number(row.targetQty) : row.targetQty, 2), referencePrice: fixed(c.referencePrice, 4), allocatedAmount: fixed(c.amount ?? c.allocatedAmount, 4), saleItemId: c.saleItemId ?? null })).sort((a,b) => Number(a.productId)-Number(b.productId)) : [],
  }
}
function lineKey(row, defaultWarehouseId = null) {
  return row.lineKey != null ? `group:${row.lineKey}` : `product:${row.productId ?? row.product_id}:${row.warehouseId ?? row.warehouse_id ?? defaultWarehouseId}`
}
function lineDiff(before = [], after = [], defaultWarehouseId = null) {
  const map = rows => new Map(rows.map(row => [lineKey(row, defaultWarehouseId), canonicalLine(row, defaultWarehouseId)]))
  const old = map(before), next = map(after)
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap(key => {
    const a = old.get(key) || null, b = next.get(key) || null
    const comparable = line => { if (!line) return null; const {sourceItemId: _id,...value}=line; return { ...value, components: line.components.map(({ saleItemId: _componentId, ...component }) => component) } }
    return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b)) ? [] : [{ key, action: !a ? 'added' : !b ? 'removed' : 'changed', before: a, after: b }]
  })
}
async function captureSaleSnapshot(conn, orderId, order) {
  const [items] = await conn.query('SELECT * FROM sale_order_items WHERE order_id=? ORDER BY id FOR UPDATE', [orderId])
  const physical = items.filter(row => Number(row.quantity) > 0)
  if (order.commercial_model !== 'kit-v1') return physical
  const store = require('../sale/sale.commercial-store')
  return [...physical, ...(await store.loadGroups(conn, orderId, { lock: true })).map(store.view)]
}
// Keep the established action/fingerprint protocol. This additional check rejects reusing an intent with a changed body.
async function assertChangeRequest(conn, { requestKey, action, userId, payload }) {
  const fingerprint = creationFingerprint(payload)
  const key = requestKey != null ? String(requestKey).trim() : ''
  if (!key) return fingerprint
  // Preliminary lookup must not lock an empty index range. Business headers already serialize this resource.
  const [receipts] = await conn.query(
    `SELECT id,request_fingerprint FROM operation_requests WHERE request_key=? AND (action=? OR action LIKE ?) AND user_id <=> ?`,
    [key, action, `${action}.%`, userId ?? null],
  )
  if (receipts.some(row => row.request_fingerprint && row.request_fingerprint !== fingerprint)) throw new AppError('该请求键已用于不同内容，请核对原结果后重新提交', 409, 'CHANGE_REQUEST_CONFLICT')
  if (receipts.length) {
    const [events] = await conn.query('SELECT payload_json FROM document_operation_events WHERE business_event_key IN (?)', [receipts.map(row => `request.${row.id}`)])
    for (const row of events) {
      const p = parsePayload(row.payload_json)
      if (p?.context?.requestFingerprint && p.context.requestFingerprint !== fingerprint) throw new AppError('该请求键已用于不同内容，请核对原结果后重新提交', 409, 'CHANGE_REQUEST_CONFLICT')
    }
  }
  return fingerprint
}
async function bindChangeRequest(conn, state, fingerprint) {
  if (!state?.enabled || !state.id) return
  // INSERT/duplicate handling has resolved the actual receipt. Lock its existing PK only, never a missing-key range.
  const [[receipt]] = await conn.query('SELECT id,request_fingerprint FROM operation_requests WHERE id=? FOR SHARE', [state.id])
  if (!receipt) throw new AppError('请求结果暂不可确认，请稍后重试',409,'CHANGE_REQUEST_UNCONFIRMED')
  if (receipt.request_fingerprint && receipt.request_fingerprint !== fingerprint) throw new AppError('该请求键已用于不同内容，请核对原结果后重新提交',409,'CHANGE_REQUEST_CONFLICT')
  if (state.replay) {
    // Old NULL receipts stay compatible; an already-linked audit can still prove a conflicting body.
    if (!receipt.request_fingerprint) {
      const [events] = await conn.query('SELECT payload_json FROM document_operation_events WHERE business_event_key=?', [`request.${state.id}`])
      if (events.some(row => { const stored = parsePayload(row.payload_json)?.context?.requestFingerprint; return stored && stored !== fingerprint })) throw new AppError('该请求键已用于不同内容，请核对原结果后重新提交',409,'CHANGE_REQUEST_CONFLICT')
    }
    return
  }
  await conn.query('UPDATE operation_requests SET request_fingerprint=? WHERE id=?', [fingerprint, state.id])
}
function parsePayload(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw || null } catch { return null }
}
async function appendChangeAudit(conn, { documentType, documentId, title, operator, applicant, approver, reason, before = [], after = [], context = {}, requestState, businessEventKey, kind = 'line_changes', description }) {
  const payload = { version: 1, kind, reason: normalizeReason(reason), quantityScale: 2, priceScale: 4,
    actors: { operator: actor(operator, 'operator'), ...(applicant ? { applicant: actor(applicant, 'applicant') } : {}), ...(approver ? { approver: actor(approver, 'approver') } : {}) },
    rows: lineDiff(before, after, context.warehouseId), context }
  if (kind === 'line_changes' && !payload.rows.length && context.phase !== 'cancellation_requested') { if (operator) operator.changeAuditHandled = true; return null }
  const summary = description || (kind === 'price_history_refs' ? `变更 ${context.priceHistoryIds?.length || 0} 项价格，详情取自商品价格历史` : `变更 ${payload.rows.length} 行${context.pending ? '，等待仓库确认' : ''}`)
  const key = businessEventKey || (requestState?.id ? `request.${requestState.id}` : `change.${randomUUID()}`)
  const [result] = await conn.query(
    `INSERT INTO document_operation_events (document_type,document_id,operation_log_id,title,description,created_by,created_by_name,payload_version,payload_json,business_event_key) VALUES (?,?,?,?,?,?,?,1,?,?)`,
    [documentType, documentId, operator?.operationLogId ?? null, title, summary, payload.actors.operator.id, payload.actors.operator.name, JSON.stringify(payload), key],
  )
  if (operator) operator.changeAuditHandled = true
  return { id: Number(result.insertId), payload, key }
}
module.exports = { normalizeReason, canonicalLine, lineDiff, captureSaleSnapshot, assertChangeRequest, bindChangeRequest, appendChangeAudit, parsePayload }
