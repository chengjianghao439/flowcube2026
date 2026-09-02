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

const createSchema = z.object({
  code:   z.string().trim().min(1, '角色编码不能为空').max(50, '角色编码最长 50 字符'),
  name:   z.string().trim().min(1, '角色名称不能为空').max(50, '角色名称最长 50 字符'),
  remark: z.string().trim().max(255, '备注最长 255 字符').optional().nullable(),
})

router.get('/', requirePermission(PERMISSIONS.ROLE_VIEW), ctrl.list)

router.get('/:roleId/permissions', requirePermission(PERMISSIONS.ROLE_VIEW), vParams(idSchema), ctrl.permissions)

// 复制角色（含权限）——仅超管（同 updatePermissions 的提权链防护）
router.post('/:roleId/duplicate',
  requirePermission(PERMISSIONS.ROLE_ASSIGN),
  (req, res, next) => {
    if (Number(req.user?.roleId) !== 1) {
      return next(new AppError('仅管理员可复制角色', 403, 'ROLE_ASSIGN_ADMIN_ONLY'))
    }
    return next()
  },
  validateParams(idSchema),
  validateBody(duplicateSchema),
  ctrl.duplicate,
)

// 更新角色权限（仅超管，2026-08-22 加固）：role.assign 是提权链的根——
// 持该权限者可给任意角色（含自己）授 user.update/role.assign/settings.update 等
// 管理权限。权限码本身可被授予，故在路由层再加「仅超管」硬校验。
router.put('/:roleId/permissions',
  requirePermission(PERMISSIONS.ROLE_ASSIGN),
  (req, res, next) => {
    if (Number(req.user?.roleId) !== 1) {
      return next(new AppError('仅管理员可调整角色权限', 403, 'ROLE_ASSIGN_ADMIN_ONLY'))
    }
    return next()
  },
  vParams(idSchema),
  async (req, res, next) => {
    try {
      const roleId = req.params.roleId
      if (roleId === 1) throw new AppError('管理员权限不可修改', 400)
      const { permissions } = req.body
      if (!Array.isArray(permissions)) throw new AppError('permissions 格式错误', 400)
      req.params.roleId = roleId
      req.body.permissions = permissions
      return ctrl.updatePermissions(req, res, next)
    } catch (e) { next(e) }
  },
)

// 新增角色（仅超管，同 updatePermissions/duplicate 的提权链防护）
router.post('/',
  requirePermission(PERMISSIONS.ROLE_ASSIGN),
  (req, res, next) => {
    if (Number(req.user?.roleId) !== 1) {
      return next(new AppError('仅管理员可新增角色', 403, 'ROLE_ASSIGN_ADMIN_ONLY'))
    }
    return next()
  },
  validateBody(createSchema),
  ctrl.create,
)

// 删除角色（仅超管）。清理权限与角色在同一事务，防残留。
router.delete('/:roleId',
  requirePermission(PERMISSIONS.ROLE_ASSIGN),
  (req, res, next) => {
    if (Number(req.user?.roleId) !== 1) {
      return next(new AppError('仅管理员可删除角色', 403, 'ROLE_ASSIGN_ADMIN_ONLY'))
    }
    return next()
  },
  vParams(idSchema),
  ctrl.remove,
)

module.exports = router
