const { Router } = require('express')
const { z } = require('zod')
const authController = require('./auth.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()

const loginSchema = z.object({
  username: z.string().min(1, '账号不能为空'),
  password: z.string().min(1, '密码不能为空'),
})

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

// POST /api/auth/login — 公开接口
router.post('/login', validateBody(loginSchema), authController.login)

// GET /api/auth/me — 需要认证
router.get('/me', authMiddleware, authController.getMe)

// PUT /api/auth/change-password — 修改自己的密码
router.put('/change-password', authMiddleware, validateBody(z.object({ oldPassword:z.string().min(1), newPassword:z.string().min(6,'新密码至少6位') })), async (req, res, next) => {
  try {
    const bcrypt = require('bcryptjs')
    const { pool } = require('../../config/db')
    const { successResponse } = require('../../utils/response')
    const AppError = require('../../utils/AppError')
    const [[user]] = await pool.query('SELECT password FROM sys_users WHERE id=? AND deleted_at IS NULL', [req.user.userId])
    if (!user) throw new AppError('用户不存在', 404)
    const ok = await bcrypt.compare(req.body.oldPassword, user.password)
    if (!ok) throw new AppError('旧密码错误', 400)
    const hash = await bcrypt.hash(req.body.newPassword, 10)
    await pool.query('UPDATE sys_users SET password=? WHERE id=?', [hash, req.user.userId])
    return successResponse(res, null, '密码修改成功，请重新登录')
  } catch (e) { next(e) }
})

// PUT /api/auth/profile — 修改个人信息
router.put('/profile', authMiddleware, validateBody(z.object({ realName:z.string().min(1) })), async (req, res, next) => {
  try {
    const { pool } = require('../../config/db')
    const { successResponse } = require('../../utils/response')
    await pool.query('UPDATE sys_users SET real_name=? WHERE id=?', [req.body.realName, req.user.userId])
    return successResponse(res, null, '信息更新成功')
  } catch (e) { next(e) }
})

module.exports = router
