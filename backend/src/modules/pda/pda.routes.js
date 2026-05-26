const { Router } = require('express')
const { z } = require('zod')
const { successResponse } = require('../../utils/response')
const { asyncRoute, validateBody } = require('../../utils/route')
const { authMiddleware } = require('../../middleware/auth')
const pdaSessions = require('./pda.sessions.service')
const ctrl = require('./pda.controller')
const router = Router()

const createSessionSchema = z.object({
  device_code:   z.string().min(1).max(64),
  device_secret: z.string().min(1).max(255),
})

/**
 * POST /api/pda/sessions
 * 第一阶段设备会话能力：要求用户已登录，但不影响既有 PDA 作业路径。
 */
router.post('/sessions', authMiddleware, validateBody(createSessionSchema), asyncRoute(async (req, res) => {
  const data = await pdaSessions.createSession({
    deviceCode: req.body.device_code,
    deviceSecret: req.body.device_secret,
    userId: req.user.userId,
  })
  return successResponse(res, {
    session_token: data.sessionToken,
    scopes: data.scopes,
    expires_at: data.expiresAt,
    warehouse_id: data.warehouseId,
  }, 'PDA 设备会话已创建')
}))

/**
 * GET /api/pda/version
 * 返回当前最新 APK 版本信息（无需登录，PDA 启动时静默检查）
 */
router.get('/version', asyncRoute(ctrl.getVersion))

/**
 * GET /api/pda/download
 * 下载最新 APK 文件（支持 Range 断点续传）
 */
router.get('/download', asyncRoute(ctrl.download))

module.exports = router
