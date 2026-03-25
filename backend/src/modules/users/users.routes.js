const { Router } = require('express')
const { z } = require('zod')
const usersController = require('./users.controller')
const { authMiddleware } = require('../../middleware/auth')

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
  roleId: z.number().int().min(1).max(2),
  tenantId: z.coerce.number().int().min(0).optional(),
})

const updateSchema = z.object({
  realName: z.string().min(1, '姓名不能为空').max(50),
  roleId: z.number().int().min(1).max(2),
  isActive: z.boolean(),
  tenantId: z.coerce.number().int().min(0).optional(),
})

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, '新密码至少 6 位').max(100),
})

router.use(authMiddleware)

router.get('/',              usersController.list)
router.get('/:id',           usersController.detail)
router.post('/',             validateBody(createSchema),        usersController.create)
router.put('/:id',           validateBody(updateSchema),        usersController.update)
router.put('/:id/password',  validateBody(resetPasswordSchema), usersController.resetPassword)
router.delete('/:id',        usersController.remove)

module.exports = router
