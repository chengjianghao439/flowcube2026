const { Router } = require('express')
const { z } = require('zod')
const usersController = require('./users.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const message = result.error.errors.map((e) => e.message).join('；')
      return res.status(400).json({ success: false, message, data: null })
    }
    req.body = result.data
    next()
  }
}

// 角色可动态创建；管理员角色仍由专用引导流程维护，赋予边界由 service 校验。
const NON_ADMIN_ROLE = z.number().int().min(2).max(Number.MAX_SAFE_INTEGER)

const createSchema = z.object({
  username: z.string().trim().min(2, '账号至少 2 个字符').max(50),
  password: z.string().min(6, '密码至少 6 位').max(100),
  realName: z.string().trim().min(1, '姓名不能为空').max(50),
  roleId: NON_ADMIN_ROLE,
  departmentId: z.number().int().positive().nullable().optional(),
})

// allowSelfApprove 是提权类字段（豁免「申请人不得批自己的单」内控），schema 放行但
// service 层 assertCanGrantSelfApprove 限定只有超管能设；不传 = 保持原值。
const updateSchema = z.object({
  realName: z.string().trim().min(1, '姓名不能为空').max(50),
  roleId: NON_ADMIN_ROLE.optional(),
  isActive: z.boolean(),
  departmentId: z.number().int().positive().nullable().optional(),
  allowSelfApprove: z.boolean().optional(),
})

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, '新密码至少 6 位').max(100),
})

router.use(authMiddleware)

router.get('/',              requirePermission(PERMISSIONS.USER_VIEW), usersController.list)
router.get('/assignable-roles', usersController.assignableRoles)
router.get('/options',       usersController.options)
// 登录者查看自己的信息与仓库授权，不要求其拥有管理其他用户的 user.view。
router.get('/me',            usersController.myDetail)
router.get('/me/warehouse-scope', usersController.myWarehouseScope)
router.get('/:id',           requirePermission(PERMISSIONS.USER_VIEW), usersController.detail)
router.post('/',             requirePermission(PERMISSIONS.USER_CREATE), validateBody(createSchema),        usersController.create)
router.put('/:id',           requirePermission(PERMISSIONS.USER_UPDATE), validateBody(updateSchema),        usersController.update)
router.put('/:id/password',  requirePermission(PERMISSIONS.USER_RESET_PASSWORD), validateBody(resetPasswordSchema), usersController.resetPassword)
// 仓库数据权限：空数组=不限仓。管理入口与用户编辑同权限。
router.get('/:id/warehouse-scope', requirePermission(PERMISSIONS.USER_VIEW), usersController.warehouseScope)
router.put('/:id/warehouse-scope', requirePermission(PERMISSIONS.USER_UPDATE), validateBody(z.object({ warehouseIds: z.array(z.number().int().positive()).max(100) })), usersController.setWarehouseScope)
router.delete('/:id',        requirePermission(PERMISSIONS.USER_DELETE), usersController.remove)

module.exports = router
