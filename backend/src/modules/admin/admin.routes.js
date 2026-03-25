const { Router } = require('express')
const { z } = require('zod')
const { authMiddleware } = require('../../middleware/auth')
const { successResponse } = require('../../utils/response')
const inboundSvc = require('../inbound-tasks/inbound-tasks.service')
const { pool } = require('../../config/db')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) {
      return res.status(400).json({
        success: false,
        message: r.error.errors.map(e => e.message).join('；'),
        data: null,
      })
    }
    req.body = r.data
    next()
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.roleId !== 1) {
    return res.status(403).json({ success: false, message: '仅管理员可执行补录上架', data: null })
  }
  next()
}

async function getOp(userId) {
  const [[u]] = await pool.query('SELECT id, username, real_name FROM sys_users WHERE id=?', [userId])
  return { userId: u.id, username: u.username, realName: u.real_name }
}

const adminPutawaySchema = z.object({
  taskId: z.number().int().positive('任务无效'),
  containerId: z.number().int().positive('请选择容器'),
  locationId: z.number().int().positive('请选择库位'),
})

/** POST /api/admin/putaway — ERP 禁用时由管理员补录上架（同业务逻辑，不经 PDA 头校验） */
router.post('/putaway', requireAdmin, vBody(adminPutawaySchema), async (req, res, next) => {
  try {
    const { taskId, containerId, locationId } = req.body
    const operator = await getOp(req.user.userId)
    await inboundSvc.putaway(taskId, { containerId, locationId }, operator)
    return successResponse(res, null, '补录上架成功')
  } catch (e) {
    next(e)
  }
})

module.exports = router
