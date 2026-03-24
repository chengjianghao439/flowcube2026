const { Router } = require('express')
const { z } = require('zod')
const { pool } = require('../../config/db')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')
const router = Router()
router.use(authMiddleware)

const vParams = s => (req,res,next) => {
  const r = s.safeParse(req.params)
  if (!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null})
  req.params = r.data; next()
}
const idSchema = z.object({ roleId: z.coerce.number().int().positive('roleId 必须为正整数') })

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id,code,name,remark FROM sys_roles ORDER BY id ASC')
    return successResponse(res, rows, '查询成功')
  } catch (e) { next(e) }
})

router.get('/:roleId/permissions', vParams(idSchema), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT permission FROM sys_role_permissions WHERE role_id=?', [req.params.roleId])
    return successResponse(res, rows.map(r => r.permission), '查询成功')
  } catch (e) { next(e) }
})

// 更新角色权限（仅管理员）
router.put('/:roleId/permissions', vParams(idSchema), async (req, res, next) => {
  try {
    if (req.user.roleId !== 1) return res.status(403).json({ success:false, message:'无权操作', data:null })
    const roleId = req.params.roleId
    if (roleId === 1) return res.status(400).json({ success:false, message:'管理员权限不可修改', data:null })
    const { permissions } = req.body
    if (!Array.isArray(permissions)) return res.status(400).json({ success:false, message:'permissions 格式错误', data:null })
    await pool.query('DELETE FROM sys_role_permissions WHERE role_id=?', [roleId])
    for (const perm of permissions) {
      await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [roleId, perm])
    }
    return successResponse(res, null, '权限更新成功')
  } catch (e) { next(e) }
})

module.exports = router
