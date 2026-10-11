const { pool } = require('../../config/db')
const { loadDocument } = require('./document-registry')
const { DOCUMENT_PATHS, resolveOperation } = require('./document-operation')
const { buildProgress } = require('./document-progress')
const { parsePayload } = require('./document-change-audit')
const { isKnownChangePayload, taskReferences, validId, rowsInScope } = require('./document-history-scope')
function savedEvent(row, type, id) {
  const parsed = parsePayload(row.payload_json)
  const payload = Number(row.payload_version) === 1 && isKnownChangePayload(parsed) ? parsed : null
  const event = { id: `operation-${row.id}`, title: row.title, description: row.description, createdByName: row.createdByName, createdAt: row.createdAt, payload, source: payload?.version === 1 ? '业务变更' : '操作记录' }
  // Keep provenance private: a malformed change must not fall back to its potentially scoped summary.
  Object.defineProperty(event, '_scope', { value: { type: row.document_type || type, id: Number(row.document_id ?? id), invalid: (row.payload_version != null || (parsed && typeof parsed === 'object' && Object.hasOwn(parsed,'version'))) && !payload, raw: parsed } })
  return event
}

async function scopeSaleHistory(id, doc, operations, businessEvents, warehouseIds) {
  const references = new Map([...operations,...businessEvents].map(event => [event,taskReferences(event)]))
  const adjustmentIds = [...new Set([...references.values()].flatMap(ref => ref.adjustments))]
  const [adjustments] = adjustmentIds.length ? await pool.query(
    'SELECT id,sale_order_id,warehouse_task_id FROM sale_order_adjustments WHERE id IN (?)', [adjustmentIds],
  ) : [[]]
  const byAdjustment = new Map(adjustments.map(row => [Number(row.id),row]))
  const taskIds = [...new Set([...(doc.tasks || []).map(task => task.taskId),...[...references.values()].flatMap(ref => ref.ids),...adjustments.map(row => Number(row.warehouse_task_id))].filter(validId))]
  const [tasks] = taskIds.length ? await pool.query(
    'SELECT id,sale_order_id,warehouse_id FROM warehouse_tasks WHERE id IN (?) AND deleted_at IS NULL', [taskIds],
  ) : [[]]
  const allowed = Array.isArray(warehouseIds) ? new Set(warehouseIds.map(Number)) : null
  const byTask = new Map(tasks.filter(task => Number(task.sale_order_id) === Number(id) && (!allowed || allowed.has(Number(task.warehouse_id)))).map(task => [Number(task.id),task]))
  const visible = event => {
    const ref = references.get(event)
    if (!ref.valid) return false
    const ids = [...ref.ids]
    for (const adjustmentId of ref.adjustments) {
      const adjustment = byAdjustment.get(adjustmentId)
      if (!adjustment || Number(adjustment.sale_order_id) !== Number(id) || !validId(Number(adjustment.warehouse_task_id))) return false
      const taskId = Number(adjustment.warehouse_task_id)
      if (ref.ids.length && !ref.ids.includes(taskId)) return false
      ids.push(taskId)
    }
    if (!ids.every(taskId => byTask.has(taskId))) return false
    // A reason/actor/summary applies to the whole change; partial row filtering cannot authorize it.
    if (event.payload?.version === 1 && !rowsInScope(event.payload,warehouseIds)) return false
    return true
  }
  const visibleOperations = operations.filter(visible)
  return { doc: { ...doc,tasks: (doc.tasks || []).filter(task => byTask.has(Number(task.taskId))), activityTaskAccessChecked:true,
    activityAuditIds:visibleOperations.filter(event=>event.payload?.version===1).map(event=>Number(event.id.replace('operation-',''))) }, operations: visibleOperations, businessEvents: businessEvents.filter(visible) }
}
async function enrichPriceEvents(events) {
  const refs = events.filter(event => event.payload?.version === 1 && event.payload?.kind === 'price_history_refs')
  const ids = [...new Set(refs.flatMap(event => event.payload.context?.priceHistoryIds || []).filter(id => Number.isSafeInteger(id) && id > 0))]
  // Activity history is not capped; fetch its full deduplicated reference set once, skipping an empty IN.
  const [history] = ids.length
    ? await pool.query('SELECT * FROM product_price_history WHERE id IN (?) ORDER BY id', [ids])
    : [[]]
  const byId = new Map(history.map(row => [Number(row.id),row]))
  const labels = { a:'价格A', b:'价格B', c:'价格C', d:'价格D', cost:'进价', sale:'标签销售价' }
  for (const event of refs) event.payload.rows = (event.payload.context?.priceHistoryIds || []).flatMap(id => {
    const row = byId.get(Number(id))
    if (!row || Number(row.product_id) !== Number(event.payload.context.productId)) return []
    const line = price => ({ kind:'price', productId:Number(row.product_id),productCode:row.product_code,productName:row.product_name, priceType:labels[row.price_type] || '价格', quantity:null,unitPrice:price == null ? null : Number(price).toFixed(4),amount:null,unit:null,components:[],priceHistoryId:Number(row.id) })
    return [{key:`price-history:${row.id}`,action:'changed',before:line(row.old_price),after:line(row.new_price)}]
  })
  return events
}

function publicChangePayload(payload, type, warehouseIds) {
  if (!isKnownChangePayload(payload)) return null
  const allowed = new Set(Array.isArray(warehouseIds) ? warehouseIds.map(Number) : [])
  const scoped = Array.isArray(warehouseIds)
  const visible = line => !line || !scoped || (line.warehouseId == null ? ['product','price','price-list'].includes(type) : allowed.has(Number(line.warehouseId)))
  const lineKeys = ['kind','sourceItemId','productId','productCode','productName','warehouseId','quantity','unitPrice','baseUnitPriceExact','entryUnitPrice','amount','unit','entryUnit','entryQty','entryQtyBasis','originalEntryQty','conversionRate','kitVersionId','snapshotRevision','priceType','priceHistoryId']
  const componentKeys = ['productId','productCode','productName','unit','baseQty','requiredQty','referencePrice','allocatedAmount','saleItemId']
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key,value[key]]))
  const line = value => value ? { ...pick(value,lineKeys),components:(Array.isArray(value.components) ? value.components : []).map(c => pick(c,componentKeys)) } : null
  const rows = payload.rows.filter(row => visible(row.before) && visible(row.after)).map(row => ({key:row.key,action:row.action,before:line(row.before),after:line(row.after)}))
  const contextKeys = ['phase','saleEventId','warehouseId','warehouseTaskId','warehouseTaskIds','adjustmentId','adjustmentNo','pending','productId','approvalId','priceHistoryIds']
  return {version:1,kind:payload.kind,reason:typeof payload.reason === 'string' ? payload.reason : null,quantityScale:2,priceScale:4,actors:Object.fromEntries(['operator','applicant','approver'].filter(role => payload.actors?.[role]).map(role => [role,pick(payload.actors[role],['id','name','role'])])),rows,context:pick(payload.context || {},contextKeys),hiddenRowCount:payload.rows.length-rows.length}
}
async function loadOperations(type, id) {
  const [saved] = await pool.query(
    `SELECT id,document_type,document_id,title,description,payload_version,payload_json,created_by_name AS createdByName,created_at AS createdAt
     FROM document_operation_events WHERE (document_type=? AND document_id=?) OR (?='product' AND document_type='price' AND JSON_EXTRACT(payload_json,'$.context.productId')=?) ORDER BY id DESC`, [type, id, type, id])
  const prefix = `${DOCUMENT_PATHS[type]}/${id}`
  // Historical request logs have no response payload. Only exact resource paths are attributable.
  const [legacy] = await pool.query(
    `SELECT l.id,l.method,l.path,l.status_code,l.user_name,l.created_at
     FROM operation_logs l LEFT JOIN document_operation_events e ON e.operation_log_id=l.id
     WHERE (l.path=? OR l.path LIKE ?) AND l.status_code >= 200 AND l.status_code < 300
       AND e.id IS NULL AND COALESCE(l.document_change_handled,0)=0 ORDER BY l.id DESC`, [prefix, `${prefix}/%`])
  return enrichPriceEvents([
    ...(type === 'product' || type === 'price-list' ? [] : await require('../fulfillment/fulfillment.service').events(type, id)),
    ...saved.map(row => savedEvent(row,type,id)),
    ...legacy.flatMap(e => {
      const op = resolveOperation(e.method, e.path, e.status_code, { success: true })
      return op && op.type === type && op.id === id ? [{ id: `legacy-${e.id}`, title: op.title, description: null, createdByName: e.user_name, createdAt: e.created_at, source: '历史请求记录' }] : []
    }),
  ])
}

async function loadRelatedOperations(related) {
  const events = []
  const byType = new Map()
  for (const [type, id] of related) {
    if (!byType.has(type)) byType.set(type, new Set())
    byType.get(type).add(Number(id))
  }
  for (const [type, idSet] of byType) {
    const ids = [...idSet]
    for (let start = 0; start < ids.length; start += 100) {
      const chunk = ids.slice(start, start + 100)
      const [saved] = await pool.query(
        `SELECT id,document_type,document_id,title,description,payload_version,payload_json,created_by_name AS createdByName,created_at AS createdAt
         FROM document_operation_events WHERE document_type=? AND document_id IN (?) ORDER BY id DESC`, [type, chunk])
      events.push(...saved.map(row => savedEvent(row,type,row.document_id)))
      const paths = chunk.map(id => `${DOCUMENT_PATHS[type]}/${id}`)
      const conditions = paths.map(() => '(l.path=? OR l.path LIKE ?)').join(' OR ')
      const [legacy] = await pool.query(
        `SELECT l.id,l.method,l.path,l.status_code,l.user_name,l.created_at
         FROM operation_logs l LEFT JOIN document_operation_events e ON e.operation_log_id=l.id
         WHERE (${conditions}) AND l.status_code >= 200 AND l.status_code < 300
           AND e.id IS NULL AND COALESCE(l.document_change_handled,0)=0 ORDER BY l.id DESC`, paths.flatMap(path => [path, `${path}/%`]))
      events.push(...legacy.flatMap(e => {
        const op = resolveOperation(e.method, e.path, e.status_code, { success: true })
        return op && op.type === type && idSet.has(Number(op.id))
          ? [{ id: `legacy-${e.id}`, title: op.title, description: null, createdByName: e.user_name, createdAt: e.created_at, source: '历史请求记录' }] : []
      }))
    }
  }
  return events
}
async function loadBusinessEvents(type, id, doc) {
  if (type === 'product') {
    const [rows] = await pool.query('SELECT * FROM product_price_history WHERE product_id=? ORDER BY id DESC', [id])
    return rows.map(row => ({ id:`price-history-${row.id}`,priceHistoryId:Number(row.id),title:'历史商品改价',description:`${row.price_type}：${row.old_price == null ? '未记录' : Number(row.old_price).toFixed(4)} → ${row.new_price == null ? '未记录' : Number(row.new_price).toFixed(4)}${row.remark ? `；${row.remark}` : ''}`,createdAt:row.created_at,createdByName:row.change_source === 'approval' ? null : row.operator_name,source:row.change_source === 'approval' ? '商品价格历史（原操作人角色未留存）' : '商品价格历史' }))
  }
  if (type === 'sale' || type === 'inbound') return (doc.timeline || []).map(e => ({ ...e, id: `business-${e.id}`, source: '业务事件' }))
  let rows = []
  if (type === 'transfer') {
    ;[rows] = await pool.query('SELECT * FROM transfer_order_events WHERE transfer_order_id=? ORDER BY id DESC', [id])
  } else if (type === 'purchase-return' || type === 'sale-return') {
    ;[rows] = await pool.query('SELECT * FROM return_order_events WHERE return_type=? AND return_id=? ORDER BY id DESC', [type === 'sale-return' ? 'sale' : 'purchase', id])
  }
  return rows.map(e => ({ id: `business-${e.id}`, title: e.title, description: e.description, createdByName: e.created_by_name, createdAt: e.created_at, source: '业务事件' }))
}
async function getActivity(type, id, user) {
  // Authorization and data scope must finish before any event/quantity read.
  let doc = await loadDocument(type, id, user)
  const [rawOperations, rawBusinessEvents] = await Promise.all([
    loadOperations(type, id), loadBusinessEvents(type, id, doc),
  ])
  const scoped = type === 'sale' ? await scopeSaleHistory(id,doc,rawOperations,rawBusinessEvents,user.warehouseIds) : { doc,operations:rawOperations,businessEvents:rawBusinessEvents }
  doc = scoped.doc
  const { operations,businessEvents } = scoped
  const progress = await buildProgress(type, id, doc, user)
  let related = []
  if (type === 'sale-return') {
    const [tasks] = await pool.query("SELECT id FROM return_tasks WHERE return_type='sale' AND return_id=?", [id])
    related = tasks.map(t => ['return-task', t.id])
  } else if (['purchase-return','sale','wave'].includes(type)) related = (progress.taskIds || []).map(taskId=>['warehouse-task',taskId])
  const relatedEvents = await loadRelatedOperations(related)
  const hasBusinessCreation = businessEvents.some(e => /创建|新建/.test(e.title))
  const uniqueOperations = hasBusinessCreation
    ? operations.filter(e => e.title !== '创建单据')
    : operations
  // Even a hidden change supersedes its original summary, otherwise that summary leaks back in.
  const linkedSaleIds = new Set(rawOperations.map(e => e._scope?.raw?.context?.saleEventId).map(value=>typeof value==='string' && /^[1-9]\d*$/.test(value) ? Number(value) : value).filter(validId))
  const linkedPriceIds = new Set(operations.filter(e => e.payload?.version === 1 && e.payload.kind === 'price_history_refs').flatMap(e => e.payload.rows.map(row => Number(row.before?.priceHistoryId))))
  const uniqueBusiness = businessEvents.filter(e => !(type === 'sale' && linkedSaleIds.has(Number(String(e.id).replace('business-','')))) && !(type === 'product' && linkedPriceIds.has(e.priceHistoryId)))
  const events = [...uniqueBusiness, ...uniqueOperations, ...relatedEvents, ...(progress.events || [])]
  if (doc.createdAt && !events.some(e => /创建|新建/.test(e.title))) {
    events.push({ id: 'created', title: '创建单据', createdAt: doc.createdAt, createdByName: doc.operatorName || doc.applicantName || null, description: null, source: '单据创建信息' })
  }
  for (const event of events) if (event.payload) event.payload = publicChangePayload(event.payload, type, user.warehouseIds)
  events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || String(b.id).localeCompare(String(a.id)))
  return { status: doc.receiptStatus?.label || doc.statusName || doc.statusLabel || '', sections: progress.sections, events,
    historyNote: '展示已留存的业务事件与操作记录；历史未记录或已清理的操作无法补回。' }
}
module.exports = { getActivity, loadOperations }
