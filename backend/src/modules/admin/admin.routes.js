const { Router } = require('express')
const { z } = require('zod')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const controller = require('./admin.controller')
const { validateBody } = require('../../utils/route')

const router = Router()

router.use(authMiddleware)

const adminPutawaySchema = z.object({
  taskId: z.number().int().positive('任务无效'),
  containerId: z.number().int().positive('请选择容器'),
  locationId: z.number().int().positive('请选择库位'),
})

router.post('/putaway', requirePermission(PERMISSIONS.ADMIN_PUTAWAY_EXECUTE), validateBody(adminPutawaySchema), controller.putaway)

module.exports = router
