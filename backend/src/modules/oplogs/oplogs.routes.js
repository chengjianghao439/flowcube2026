const { Router } = require('express')
const { pool } = require('../../config/db')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')
const router = Router()
router.use(authMiddleware)

router.get('/', async (req, res, next) => {
  try {
    const { page=1, pageSize=30, keyword='', module: mod='' } = req.query
    const offset = (+page-1)*+pageSize
    const like = `%${keyword}%`
    const modCond = mod ? 'AND module=?' : ''
    const params = mod ? [like,like,mod,+pageSize,offset] : [like,like,+pageSize,offset]
    const cntParams = mod ? [like,like,mod] : [like,like]
    const [rows] = await pool.query(
      `SELECT id,user_id,user_name,method,path,module,request_body,status_code,ip,created_at
       FROM operation_logs
       WHERE (user_name LIKE ? OR path LIKE ?) ${modCond}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`, params)
    const [[{total}]] = await pool.query(
      `SELECT COUNT(*) AS total FROM operation_logs WHERE (user_name LIKE ? OR path LIKE ?) ${modCond}`, cntParams)
    const list = rows.map(r => ({
      id:r.id, userId:r.user_id, userName:r.user_name||'未知', method:r.method,
      path:r.path, module:r.module, requestBody:r.request_body,
      statusCode:r.status_code, ip:r.ip, createdAt:r.created_at
    }))
    return successResponse(res, { list, pagination:{page:+page,pageSize:+pageSize,total} }, '查询成功')
  } catch (e) { next(e) }
})

// 清空日志（仅管理员）
router.delete('/clear', async (req, res, next) => {
  try {
    if (req.user.roleId !== 1) return res.status(403).json({ success:false, message:'无权操作', data:null })
    await pool.query('DELETE FROM operation_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)')
    return successResponse(res, null, '已清理 30 天前的日志')
  } catch (e) { next(e) }
})

module.exports = router
