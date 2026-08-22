const { pool } = require('../../config/db')
const { normalizePagination } = require('../../utils/pagination')

const findAll = async ({ page, pageSize, keyword, module: mod, startDate = '', endDate = '' }) => {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const like = `%${keyword}%`
  const conds = ['(user_name LIKE ? OR path LIKE ?)']
  const params = [like, like]
  const cntParams = [like, like]
  if (mod) {
    conds.push('module=?')
    params.push(mod)
    cntParams.push(mod)
  }
  if (startDate) {
    conds.push('created_at >= ?')
    const s = `${String(startDate).slice(0, 10)} 00:00:00`
    params.push(s)
    cntParams.push(s)
  }
  if (endDate) {
    conds.push('created_at <= ?')
    const e = `${String(endDate).slice(0, 10)} 23:59:59`
    params.push(e)
    cntParams.push(e)
  }
  const where = `WHERE ${conds.join(' AND ')}`
  const [rows] = await pool.query(
    `SELECT id,user_id,user_name,method,path,module,request_body,status_code,ip,created_at
     FROM operation_logs
     ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, ps, offset])
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM operation_logs ${where}`, cntParams)
  const list = rows.map(r => ({
    id: r.id, userId: r.user_id, userName: r.user_name || '未知', method: r.method,
    path: r.path, module: r.module, requestBody: r.request_body,
    statusCode: r.status_code, ip: r.ip, createdAt: r.created_at
  }))
  return { list, pagination: { page, pageSize: ps, total } }
}

/**
 * 清理 30 天前的操作日志（2026-08-22 加固）：改分批删除——一次性 DELETE 全量
 * 30 天前记录会在高并发下长事务 + 锁大量行，分批（每批 2000 行）循环直到删完。
 */
const clearOld = async () => {
  const BATCH = 2000
  let deleted = 0
  for (;;) {
    const [r] = await pool.query(
      'DELETE FROM operation_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) LIMIT ?',
      [BATCH],
    )
    deleted += r.affectedRows
    if (r.affectedRows < BATCH) break
  }
  return deleted
}

module.exports = { findAll, clearOld }
