const { pool } = require('../../config/db')
const { loadDocument } = require('./document-registry')
const { DOCUMENT_PATHS, resolveOperation } = require('./document-operation')
const { buildProgress } = require('./document-progress')

async function loadOperations(type, id) {
  const [saved] = await pool.query(
    `SELECT id,title,description,created_by_name AS createdByName,created_at AS createdAt
     FROM document_operation_events WHERE document_type=? AND document_id=? ORDER BY id DESC`, [type, id])
  const prefix = `${DOCUMENT_PATHS[type]}/${id}`
  // Historical request logs have no response payload. Only exact resource paths are attributable.
  const [legacy] = await pool.query(
    `SELECT l.id,l.method,l.path,l.status_code,l.user_name,l.created_at
     FROM operation_logs l LEFT JOIN document_operation_events e ON e.operation_log_id=l.id
     WHERE (l.path=? OR l.path LIKE ?) AND l.status_code >= 200 AND l.status_code < 300
       AND e.id IS NULL ORDER BY l.id DESC`, [prefix, `${prefix}/%`])
  return [
    ...await require('../fulfillment/fulfillment.service').events(type, id),
    ...saved.map(e => ({ ...e, id: `operation-${e.id}`, source: '操作记录' })),
    ...legacy.flatMap(e => {
      const op = resolveOperation(e.method, e.path, e.status_code, { success: true })
      return op && op.type === type && op.id === id ? [{ id: `legacy-${e.id}`, title: op.title, description: null, createdByName: e.user_name, createdAt: e.created_at, source: '历史请求记录' }] : []
    }),
  ]
}
async function loadBusinessEvents(type, id, doc) {
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
  const doc = await loadDocument(type, id, user)
  const [operations, businessEvents, progress] = await Promise.all([
    loadOperations(type, id), loadBusinessEvents(type, id, doc), buildProgress(type, id, doc, user),
  ])
  let related = []
  if (type === 'sale-return') {
    const [tasks] = await pool.query("SELECT id FROM return_tasks WHERE return_type='sale' AND return_id=?", [id])
    related = tasks.map(t => ['return-task', t.id])
  } else if (type === 'purchase-return') {
    const [tasks] = await pool.query("SELECT id FROM warehouse_tasks WHERE task_type='purchase_return' AND return_id=?", [id])
    related = tasks.map(t => ['warehouse-task', t.id])
  } else if (type === 'sale' || type === 'wave') related = (doc.tasks || []).map(t => ['warehouse-task', t.taskId])
  const relatedEvents = []
  for (const [relatedType, relatedId] of related) relatedEvents.push(...await loadOperations(relatedType, relatedId))
  const events = [...businessEvents, ...operations, ...relatedEvents, ...(progress.events || [])]
  if (doc.createdAt && !events.some(e => /创建|新建/.test(e.title))) {
    events.push({ id: 'created', title: '创建单据', createdAt: doc.createdAt, createdByName: doc.operatorName || doc.applicantName || null, description: null, source: '单据创建信息' })
  }
  events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || String(b.id).localeCompare(String(a.id)))
  return { status: doc.receiptStatus?.label || doc.statusName || doc.statusLabel || '', sections: progress.sections, events,
    historyNote: '展示已留存的业务事件与操作记录；历史未记录或已清理的操作无法补回。' }
}
module.exports = { getActivity, loadOperations }
