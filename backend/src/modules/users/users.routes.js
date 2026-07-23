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

const createSchema = z.object({
  username: z.string().min(2, '账号至少 2 个字符').max(50),
  password: z.string().min(6, '密码至少 6 位').max(100),
  realName: z.string().min(1, '姓名不能为空').max(50),
  roleId: z.number().int().min(1).max(5),
})

const updateSchema = z.object({
  realName: z.string().min(1, '姓名不能为空').max(50),
  roleId: z.number().int().min(1).max(5),
  isActive: z.boolean(),
})

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, '新密码至少 6 位').max(100),
})

router.use(authMiddleware)

router.get('/',              requirePermission(PERMISSIONS.USER_VIEW), usersController.list)
router.get('/options',       usersController.options)
router.get('/:id',           requirePermission(PERMISSIONS.USER_VIEW), usersController.detail)
router.post('/',             requirePermission(PERMISSIONS.USER_CREATE), validateBody(createSchema),        usersController.create)
router.put('/:id',           requirePermission(PERMISSIONS.USER_UPDATE), validateBody(updateSchema),        usersController.update)
router.put('/:id/password',  requirePermission(PERMISSIONS.USER_RESET_PASSWORD), validateBody(resetPasswordSchema), usersController.resetPassword)
// 仓库数据权限：空数组=不限仓。管理入口与用户编辑同权限。
router.get('/:id/warehouse-scope', requirePermission(PERMISSIONS.USER_VIEW), usersController.warehouseScope)
router.put('/:id/warehouse-scope', requirePermission(PERMISSIONS.USER_UPDATE), validateBody(z.object({ warehouseIds: z.array(z.number().int().positive()).max(100) })), usersController.setWarehouseScope)
router.delete('/:id',        requirePermission(PERMISSIONS.USER_DELETE), usersController.remove)

module.exports = router
