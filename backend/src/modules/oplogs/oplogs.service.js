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

const clearOld = async () => {
  await pool.query('DELETE FROM operation_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)')
}

module.exports = { findAll, clearOld }
