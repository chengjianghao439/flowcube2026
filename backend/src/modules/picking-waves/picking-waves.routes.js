const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./picking-waves.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.body = r.data; next()
  }
}

router.get('/', ctrl.list)

router.post('/', vBody(z.object({
  taskIds:  z.array(z.number().int().positive()).min(2, '至少选择 2 个任务'),
  priority: z.number().int().min(1).max(3).default(2),
  remark:   z.string().max(200).optional(),
})), ctrl.create)

router.get('/:id', ctrl.detail)

router.get('/:id/pick-route', ctrl.pickRoute)

router.post('/:id/start', ctrl.start)

router.post('/:id/finish-picking', ctrl.finishPicking)

router.post('/:id/finish', ctrl.finish)

router.post('/:id/cancel', ctrl.cancel)

router.post('/:id/route-completed', vBody(z.object({
  barcode: z.string().min(1),
})), ctrl.markRouteCompleted)

module.exports = router
