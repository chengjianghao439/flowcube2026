const { pool } = require('../../config/db')
const { definitions, eligibleOwners } = require('./fulfillment.access')
const { detect } = require('./fulfillment.detect')
const { event } = require('./fulfillment.events')
const { fulfillmentFallback } = require('./fulfillment.fallback')
const logger = require('../../utils/logger')

async function syncDocument(type, id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query(`SELECT * FROM ${definitions[type].table} WHERE id=? FOR UPDATE`, [id])
    if (!row) { await conn.rollback(); return }
    const active = row.deleted_at ? [] : await detect(conn, type, row)
    const [existing] = await conn.query("SELECT * FROM order_fulfillment_issues WHERE document_type=? AND document_id=? AND source='auto' ORDER BY id FOR UPDATE", [type, id])
    const owners = active.length ? await eligibleOwners(conn, type, row) : []
    const ownerId = owners.find(o => o.id === Number(row.operator_id))?.id || null
    for (const condition of active) {
      const issue = existing.find(i => i.source_key === condition.key)
      if (!issue) {
        const [result] = await conn.query(`INSERT INTO order_fulfillment_issues(document_type,document_id,source_key,source,title,reason,action_path,owner_id,due_at)
          VALUES(?,?,?,'auto',?,?,?,?,?)`, [type, id, condition.key, condition.title, condition.reason, condition.actionPath, ownerId, `${condition.dueDate} 23:59:59`])
        await event(conn, type, id, '发现履约事项', `${condition.title}：${condition.reason}`, null, result.insertId)
      } else if (issue.status === 'resolved') {
        await conn.query("UPDATE order_fulfillment_issues SET status='open',reason=?,result=NULL,resolved_at=NULL,detected_at=NOW(),due_at=?,version=version+1 WHERE id=?", [condition.reason, `${condition.dueDate} 23:59:59`, issue.id])
        await event(conn, type, id, '阻塞再次发生', `${condition.title}：${condition.reason}`, null, issue.id)
      } else if (issue.reason !== condition.reason) {
        await conn.query('UPDATE order_fulfillment_issues SET reason=?,version=version+1 WHERE id=?', [condition.reason, issue.id])
      }
    }
    for (const issue of existing) {
      if (issue.status === 'resolved' || active.some(a => a.key === issue.source_key)) continue
      await conn.query("UPDATE order_fulfillment_issues SET status='resolved',result='系统检测：阻塞条件已解除',resolved_at=NOW(),version=version+1 WHERE id=?", [issue.id])
      await event(conn, type, id, '阻塞条件已解除', issue.title, null, issue.id)
    }
    await conn.commit()
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
const activeStatuses = { sale: '1,2,3,6', purchase: '2,5', inbound: '1,2,3', transfer: '2,3' }
async function listFallbackDocuments(type, cursor, limit) {
  const [rows] = await pool.query(`SELECT d.id FROM ${definitions[type].table} d WHERE d.id>? AND
    ((d.deleted_at IS NULL AND d.status IN (${activeStatuses[type]})) OR EXISTS(SELECT 1 FROM order_fulfillment_issues i WHERE i.document_type=? AND i.document_id=d.id AND i.status<>'resolved'))
    ORDER BY d.id LIMIT ?`, [cursor, type, limit])
  return rows
}
const runFulfillmentSync = () => fulfillmentFallback.run({
  types: Object.keys(definitions),
  list: listFallbackDocuments,
  sync: syncDocument,
  onFailure: (error, type, documentId) => logger.error('履约事项补扫失败', error, { type, documentId }, 'Fulfillment'),
})
module.exports = { syncDocument, runFulfillmentSync }
