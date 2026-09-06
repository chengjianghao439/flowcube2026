const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { normalizePagination } = require('../../utils/pagination')
const { definitions, definition, authorize, eligibleOwners, can } = require('./fulfillment.access')
const { commitments, saleDelivery, purchaseImpacts } = require('./fulfillment.delivery')
const { detect } = require('./fulfillment.detect')
const { dateOnly, assertIssueAction } = require('./fulfillment.rules')

async function event(conn, type, id, title, description, user, issueId = null) {
  await conn.query(`INSERT INTO order_fulfillment_events (document_type,document_id,issue_id,title,description,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)`,
    [type, id, issueId, title, description, user?.userId || null, user?.realName || '系统', ])
}
async function events(type, id) {
  if (!Object.hasOwn(definitions, type)) return []
  const [rows] = await pool.query('SELECT id,title,description,created_at AS createdAt,created_by_name AS createdByName FROM order_fulfillment_events WHERE document_type=? AND document_id=? ORDER BY id DESC', [type, id])
  return rows.map(r => ({ ...r, id: `fulfillment-${r.id}`, source: '履约处理记录' }))
}
async function getDocument(type, id, user) {
  const row = await authorize(pool, type, id, user)
  const [issues] = await pool.query(`SELECT i.*,u.real_name AS ownerName,(i.status<>'resolved' AND i.due_at<NOW()) AS overdue,
    (i.status<>'resolved' AND i.due_at BETWEEN NOW() AND DATE_ADD(NOW(),INTERVAL 24 HOUR)) AS dueSoon
    FROM order_fulfillment_issues i LEFT JOIN sys_users u ON u.id=i.owner_id WHERE i.document_type=? AND i.document_id=? ORDER BY i.status='resolved',i.due_at,i.id`, [type, id])
  const active = await detect(pool, type, row)
  const delivery = type === 'sale' ? await saleDelivery(pool, row, user) : null
  return { type, id, canManage: can(user, definition(type).write), issues: issues.map(i => ({ ...i, conditionActive: active.some(a => a.key === i.source_key) })),
    owners: await eligibleOwners(pool, type, row), commitments: delivery?.commitments || await commitments(pool, type, id), delivery,
    expectedDate: type === 'purchase' ? dateOnly(row.expected_date) : null,
    impacts: type === 'purchase' ? await purchaseImpacts(pool, id, user) : [], detectedCount: active.length }
}
async function transact(type, id, user, key, action, fn) {
  if (!key || key.length > 80) throw new AppError('需要不超过 80 字符的请求键', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await authorize(conn, type, id, user, true)
    const state = await beginOperationRequest(conn, { requestKey: key, action: `fulfillment.${type}.${id}.${action}`, userId: user.userId })
    if (state.replay) { await conn.rollback(); return state.responseData }
    const result = await fn(conn, row)
    await completeOperationRequest(conn, state, { data: result, resourceType: type, resourceId: id })
    await conn.commit()
    return result
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
async function setDates(type, id, body, user, key) {
  if (!['sale', 'purchase'].includes(type)) throw new AppError('此单据不支持交期维护', 400)
  return transact(type, id, user, key, 'dates', async (conn, row) => {
    if ((type === 'sale' && [4, 5].includes(Number(row.status))) || (type === 'purchase' && [3, 4, 6].includes(Number(row.status)))) throw new AppError('已结束单据不能修改交期', 409)
    const itemId = body.itemId || 0
    if (type === 'purchase' && itemId) throw new AppError('采购按整单维护交期', 400)
    if (itemId) {
      const [[item]] = await conn.query('SELECT id FROM sale_order_items WHERE id=? AND order_id=?', [itemId, id])
      if (!item) throw new AppError('明细不属于该销售单', 400)
    }
    const date = dateOnly(body.date)
    const [[previous]] = await conn.query('SELECT promised_date,original_date,processing_days FROM order_delivery_commitments WHERE document_type=? AND document_id=? AND item_id=? FOR UPDATE', [type, id, itemId])
    const before = type === 'purchase' ? dateOnly(row.expected_date) : dateOnly(previous?.promised_date)
    const original = dateOnly(previous?.original_date) || before || date
    await conn.query(`INSERT INTO order_delivery_commitments(document_type,document_id,item_id,promised_date,original_date,processing_days) VALUES(?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE promised_date=VALUES(promised_date),original_date=COALESCE(original_date,VALUES(original_date)),processing_days=VALUES(processing_days)`,
    [type, id, itemId, date, original, body.processingDays ?? null])
    if (type === 'purchase') await conn.query('UPDATE purchase_orders SET expected_date=? WHERE id=?', [date, id])
    await event(conn, type, id, type === 'sale' ? '调整承诺发货日期' : '更新采购预计到货日期', `${itemId ? `明细 #${itemId}` : '整单'}：${before || '未设置'} → ${date || '未设置'}；处理时效 ${body.processingDays ?? '待确认'} 天；${body.reason}`, user)
    return { id, itemId }
  })
}
async function createIssue(type, id, body, user, key) {
  return transact(type, id, user, key, 'create', async (conn, row) => {
    const owners = await eligibleOwners(conn, type, row)
    const ownerId = body.ownerId === undefined ? (owners.find(o => o.id === Number(row.operator_id))?.id || null) : body.ownerId
    if (ownerId != null && !owners.some(o => o.id === ownerId)) throw new AppError('负责人没有该单据的处理权限或仓库范围', 400)
    const [result] = await conn.query(`INSERT INTO order_fulfillment_issues(document_type,document_id,source_key,source,title,reason,action_path,owner_id,due_at)
      VALUES(?,?,?,'manual',?,?,?,?,?)`, [type, id, `manual:${key}`, body.title, body.reason, `${definition(type).path}/${id}?focus=fulfillment`, ownerId, body.dueDate ? `${dateOnly(body.dueDate)} 23:59:59` : null])
    await event(conn, type, id, '登记异常事项', `${body.title}：${body.reason}`, user, result.insertId)
    return { id: result.insertId }
  })
}
async function changeIssue(type, id, issueId, body, user, key) {
  return transact(type, id, user, key, `issue.${issueId}`, async (conn, row) => {
    const [[issue]] = await conn.query('SELECT * FROM order_fulfillment_issues WHERE id=? AND document_type=? AND document_id=? FOR UPDATE', [issueId, type, id])
    if (!issue) throw new AppError('事项不存在', 404)
    if (Number(issue.version) !== body.version) throw new AppError('事项已被其他人更新，请刷新', 409)
    const active = issue.source === 'auto' && (await detect(conn, type, row)).some(a => a.key === issue.source_key)
    assertIssueAction(issue, body.action, body.result, active)
    let ownerId = issue.owner_id, status = issue.status, dueAt = issue.due_at
    if (body.action === 'claim') ownerId = user.userId
    if (body.action === 'assign') ownerId = body.ownerId ?? null
    if (['claim', 'assign'].includes(body.action) && ownerId != null && !(await eligibleOwners(conn, type, row)).some(o => o.id === Number(ownerId))) throw new AppError('负责人没有该单据的处理权限或仓库范围', 400)
    if (body.action === 'progress') status = 'processing'
    if (body.action === 'resolve') status = 'resolved'
    if (body.action === 'reopen') status = 'open'
    if (body.dueDate !== undefined) dueAt = body.dueDate ? `${dateOnly(body.dueDate)} 23:59:59` : null
    await conn.query(`UPDATE order_fulfillment_issues SET owner_id=?,status=?,due_at=?,result=?,resolved_at=IF(?='resolved',NOW(),NULL),version=version+1 WHERE id=?`,
      [ownerId, status, dueAt, body.result || issue.result, status, issueId])
    const titles = { claim: '认领事项', assign: '转派事项', progress: '更新处理进展', resolve: '处理完成', reopen: '重新打开事项' }
    const ownerName = ownerId == null ? '待认领' : (await eligibleOwners(conn, type, row)).find(o => o.id === Number(ownerId))?.name || '原负责人'
    await event(conn, type, id, titles[body.action], `${issue.title}；负责人：${ownerName}；${body.result || ''}${body.dueDate !== undefined ? `；期限 ${body.dueDate || '未设置'}` : ''}`, user, issueId)
    return { id: issueId }
  })
}
async function syncDocument(type, id, user) {
  await authorize(pool, type, id, user, true)
  await require('./fulfillment.worker').syncDocument(type, id)
  return { refreshed: true }
}
async function listIssues(params, user) {
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
  if (!conditions.length) return { list: [], summary: { open: 0, mine: 0, overdue: 0, unassigned: 0 }, pagination: { page: 1, pageSize: 200, total: 0 } }
  let where = `(${conditions.join(' OR ')})`
  const [[summary]] = await pool.query(`SELECT
    COALESCE(SUM(i.status<>'resolved'),0) AS open,
    COALESCE(SUM(i.status<>'resolved' AND i.owner_id=?),0) AS mine,
    COALESCE(SUM(i.status<>'resolved' AND i.owner_id IS NULL),0) AS unassigned,
    COALESCE(SUM(i.status<>'resolved' AND i.due_at<NOW()),0) AS overdue
    FROM order_fulfillment_issues i WHERE ${where}`, [user.userId, ...values])
  if (params.filter === 'resolved') where += " AND i.status='resolved'"
  else where += " AND i.status<>'resolved'"
  if (params.filter === 'mine') { where += ' AND i.owner_id=?'; values.push(user.userId) }
  if (params.filter === 'unassigned') where += ' AND i.owner_id IS NULL'
  if (params.filter === 'overdue') where += ' AND i.due_at<NOW()'
  const { pageSize, offset } = normalizePagination(params)
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM order_fulfillment_issues i WHERE ${where}`, values)
  const [list] = await pool.query(`SELECT i.*,u.real_name AS ownerName,(i.due_at<NOW() AND i.status<>'resolved') AS overdue,
    (i.due_at BETWEEN NOW() AND DATE_ADD(NOW(),INTERVAL 24 HOUR) AND i.status<>'resolved') AS dueSoon
    FROM order_fulfillment_issues i LEFT JOIN sys_users u ON u.id=i.owner_id WHERE ${where}
    ORDER BY i.due_at IS NULL,i.due_at,i.id LIMIT ? OFFSET ?`, [...values, pageSize, offset])
  return { list, summary, pagination: { page: Number(params.page || 1), pageSize, total: Number(total) } }
}
module.exports = { event, events, getDocument, setDates, createIssue, changeIssue, listIssues, syncDocument }
