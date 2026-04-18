const { Router } = require('express')
const { z } = require('zod')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const controller = require('./admin.controller')

const router = Router()

router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error.errors.map((item) => item.message).join('；'),
        data: null,
      })
    }
    req.body = result.data
    next()
  }
}

const adminPutawaySchema = z.object({
  taskId: z.number().int().positive('任务无效'),
  containerId: z.number().int().positive('请选择容器'),
  locationId: z.number().int().positive('请选择库位'),
})

router.post('/putaway', requirePermission(PERMISSIONS.ADMIN_PUTAWAY_EXECUTE), vBody(adminPutawaySchema), controller.putaway)

module.exports = router
