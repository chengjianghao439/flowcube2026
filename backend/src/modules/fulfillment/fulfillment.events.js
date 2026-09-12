const { pool } = require('../../config/db')
const { definitions } = require('./fulfillment.access')

async function event(conn, type, id, title, description, user, issueId = null) {
  await conn.query(`INSERT INTO order_fulfillment_events (document_type,document_id,issue_id,title,description,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)`,
    [type, id, issueId, title, description, user?.userId || null, user?.realName || '系统', ])
}
async function events(type, id) {
  if (!Object.hasOwn(definitions, type)) return []
  const [rows] = await pool.query('SELECT id,title,description,created_at AS createdAt,created_by_name AS createdByName FROM order_fulfillment_events WHERE document_type=? AND document_id=? ORDER BY id DESC', [type, id])
  return rows.map(r => ({ ...r, id: `fulfillment-${r.id}`, source: '履约处理记录' }))
}
module.exports = { event, events }
