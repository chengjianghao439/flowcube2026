const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./picking-waves.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()
router.use(authMiddleware)

router.get('/', requirePermission(PERMISSIONS.PICKING_WAVE_VIEW), ctrl.list)

router.post('/', requirePermission(PERMISSIONS.PICKING_WAVE_MANAGE), validateBody(z.object({
  taskIds:  z.array(z.number().int().positive()).min(2, '至少选择 2 个任务'),
  priority: z.number().int().min(1).max(3).default(2),
  remark:   z.string().max(200).optional(),
})), ctrl.create)

router.get('/:id', requirePermission(PERMISSIONS.PICKING_WAVE_VIEW), ctrl.detail)

router.post('/:id/start', requirePermission(PERMISSIONS.PICKING_WAVE_MANAGE), ctrl.start)

router.post('/:id/finish-picking', requirePermission(PERMISSIONS.PICKING_WAVE_MANAGE), ctrl.finishPicking)

router.post('/:id/finish', requirePermission(PERMISSIONS.PICKING_WAVE_MANAGE), ctrl.finish)

router.post('/:id/cancel', requirePermission(PERMISSIONS.PICKING_WAVE_MANAGE), ctrl.cancel)

module.exports = router
