const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { z } = require('zod')
const authController = require('./auth.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()

const loginWindowMs = Number(process.env.AUTH_LOGIN_WINDOW_MS || `${15 * 60 * 1000}`)
const loginMaxPerIp = Number(process.env.AUTH_LOGIN_MAX_PER_IP || '300')

const loginLimiter = rateLimit({
  windowMs: Number.isFinite(loginWindowMs) && loginWindowMs > 0 ? loginWindowMs : 15 * 60 * 1000,
  max: Number.isFinite(loginMaxPerIp) && loginMaxPerIp > 0 ? loginMaxPerIp : 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ success: false, message: '登录尝试过于频繁，请稍后再试', data: null })
  },
})

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

// POST /api/auth/login — 公开接口（限流；反代后需 TRUST_PROXY=1 以便按真实 IP 计数）
router.post('/login', loginLimiter, validateBody(loginSchema), authController.login)

// GET /api/auth/me — 需要认证
router.get('/me', authMiddleware, authController.getMe)

// POST /api/auth/refresh — 当前 Token 有效时换取新 Token（长期运行的打印客户端等）
router.post('/refresh', authMiddleware, authController.refresh)

// PUT /api/auth/change-password — 修改自己的密码
router.put('/change-password', authMiddleware, validateBody(z.object({ oldPassword:z.string().min(1), newPassword:z.string().min(6,'新密码至少6位') })), async (req, res, next) => {
  try {
    const { successResponse } = require('../../utils/response')
    const authService = require('./auth.service')
    await authService.changePassword(req.user.userId, req.body.oldPassword, req.body.newPassword)
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
