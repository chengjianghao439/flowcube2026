const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./roles.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const AppError = require('../../utils/AppError')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody, validateParams } = require('../../utils/route')
const router = Router()
router.use(authMiddleware)

const vParams = s => (req,res,next) => {
  const r = s.safeParse(req.params)
  if (!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null})
  req.params = r.data; next()
}
const idSchema = z.object({ roleId: z.coerce.number().int().positive('roleId 必须为正整数') })

const duplicateSchema = z.object({
  code:   z.string().trim().min(1, '角色编码不能为空').max(50, '角色编码最长 50 字符'),
  name:   z.string().trim().min(1, '角色名称不能为空').max(50, '角色名称最长 50 字符'),
  remark: z.string().trim().max(255, '备注最长 255 字符').optional().nullable(),
})

router.get('/', requirePermission(PERMISSIONS.ROLE_VIEW), ctrl.list)

router.get('/:roleId/permissions', requirePermission(PERMISSIONS.ROLE_VIEW), vParams(idSchema), ctrl.permissions)

// 复制角色（含权限）——仅管理员
router.post('/:roleId/duplicate',
  requirePermission(PERMISSIONS.ROLE_ASSIGN),
  validateParams(idSchema),
  validateBody(duplicateSchema),
  ctrl.duplicate,
)

// 更新角色权限（仅管理员）
router.put('/:roleId/permissions', requirePermission(PERMISSIONS.ROLE_ASSIGN), vParams(idSchema), async (req, res, next) => {
  try {
    const roleId = req.params.roleId
    if (roleId === 1) throw new AppError('管理员权限不可修改', 400)
    const { permissions } = req.body
    if (!Array.isArray(permissions)) throw new AppError('permissions 格式错误', 400)
    req.params.roleId = roleId
    req.body.permissions = permissions
    return ctrl.updatePermissions(req, res, next)
  } catch (e) { next(e) }
})

module.exports = router
