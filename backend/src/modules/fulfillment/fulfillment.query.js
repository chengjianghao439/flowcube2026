const { normalizePagination } = require('../../utils/pagination')
const { definitions, definition, can } = require('./fulfillment.access')
// 唯一主键关联，每个事项仍恰好一行；名称沿用订单快照，不跨仓追加行级信息。
const joins = `LEFT JOIN sale_orders sale ON i.document_type='sale' AND sale.id=i.document_id
  LEFT JOIN purchase_orders purchase ON i.document_type='purchase' AND purchase.id=i.document_id
  LEFT JOIN inbound_tasks inbound ON i.document_type='inbound' AND inbound.id=i.document_id
  LEFT JOIN transfer_orders transfer ON i.document_type='transfer' AND transfer.id=i.document_id`
const documentNo = 'COALESCE(sale.order_no,purchase.order_no,inbound.task_no,transfer.order_no)'
const partyName = 'COALESCE(sale.customer_name,purchase.supplier_name,inbound.supplier_name)'
const warehouseName = "COALESCE(sale.warehouse_name,purchase.warehouse_name,inbound.warehouse_name,CONCAT(transfer.from_warehouse_name,' → ',transfer.to_warehouse_name))"

function createIssueReader(pool) {
  return async function listIssues(params, user) {
    if (params.documentType) definition(params.documentType)
    const { page, pageSize, offset } = normalizePagination(params)
    const values = [], conditions = []
    for (const [type, def] of Object.entries(definitions)) {
      if (!can(user, def.view)) continue
      let scope = ''
      const scoped = Array.isArray(user.warehouseIds)
      if (scoped && !user.warehouseIds.length) continue
      if (scoped) {
        if (type === 'transfer') scope = ' AND (d.from_warehouse_id IN (?) OR d.to_warehouse_id IN (?))'
        else scope = ' AND d.warehouse_id IN (?)'
        if (type === 'sale') scope += ' AND NOT EXISTS(SELECT 1 FROM sale_order_items si WHERE si.order_id=d.id AND COALESCE(si.warehouse_id,d.warehouse_id) NOT IN (?))'
      }
      conditions.push(`(i.document_type=? AND EXISTS(SELECT 1 FROM ${def.table} d WHERE d.id=i.document_id AND d.deleted_at IS NULL${scope}))`)
      values.push(type)
      if (scoped) { values.push(user.warehouseIds); if (type === 'transfer' || type === 'sale') values.push(user.warehouseIds) }
    }
    if (!conditions.length) return { list: [], summary: { open: 0, mine: 0, overdue: 0, unassigned: 0 }, pagination: { page, pageSize, total: 0 } }
    let where = `(${conditions.join(' OR ')})`
    const [[summary]] = await pool.query(`SELECT
      COALESCE(SUM(i.status<>'resolved'),0) AS open,
      COALESCE(SUM(i.status<>'resolved' AND i.owner_id=?),0) AS mine,
      COALESCE(SUM(i.status<>'resolved' AND i.owner_id IS NULL),0) AS unassigned,
      COALESCE(SUM(i.status<>'resolved' AND i.due_at<NOW()),0) AS overdue
      FROM order_fulfillment_issues i WHERE ${where}`, [user.userId, ...values])
    if (params.documentType) { where += ' AND i.document_type=?'; values.push(params.documentType) }
    const keyword = typeof params.keyword === 'string' ? params.keyword.trim().slice(0, 100) : ''
    if (keyword) {
      where += ` AND (i.title LIKE ? OR i.reason LIKE ? OR ${documentNo} LIKE ? OR ${partyName} LIKE ? OR ${warehouseName} LIKE ?)`
      values.push(...Array(5).fill(`%${keyword}%`))
    }
    if (params.filter === 'resolved') where += " AND i.status='resolved'"
    else where += " AND i.status<>'resolved'"
    if (params.filter === 'mine') { where += ' AND i.owner_id=?'; values.push(user.userId) }
    if (params.filter === 'unassigned') where += ' AND i.owner_id IS NULL'
    if (params.filter === 'overdue') where += ' AND i.due_at<NOW()'
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM order_fulfillment_issues i ${joins} WHERE ${where}`, values)
    const [list] = await pool.query(`SELECT i.*,${documentNo} AS documentNo,${partyName} AS partyName,${warehouseName} AS warehouseName,u.real_name AS ownerName,(i.due_at<NOW() AND i.status<>'resolved') AS overdue,
      (i.due_at BETWEEN NOW() AND DATE_ADD(NOW(),INTERVAL 24 HOUR) AND i.status<>'resolved') AS dueSoon
      FROM order_fulfillment_issues i ${joins} LEFT JOIN sys_users u ON u.id=i.owner_id WHERE ${where}
      ORDER BY i.due_at IS NULL,i.due_at,i.id LIMIT ? OFFSET ?`, [...values, pageSize, offset])
    return { list, summary, pagination: { page, pageSize, total: Number(total) } }
  }
}
module.exports = { createIssueReader }
