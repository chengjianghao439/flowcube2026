const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./inbound-tasks.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.body = r.data; next()
  }
}

const receiveSchema = z.object({
  items: z.array(z.object({
    itemId: z.number().int().positive(),
    qty:    z.number().positive('数量必须大于0'),
  })).min(1, '至少一条收货明细'),
})

const putawaySchema = z.object({
  items: z.array(z.object({
    itemId:     z.number().int().positive(),
    qty:        z.number().positive('数量必须大于0'),
    locationId: z.number().int().positive().optional(),
    rackCode:   z.string().optional(),
    level:      z.string().optional(),
    position:   z.string().optional(),
  })).min(1, '至少一条上架明细'),
})

router.use(authMiddleware)

router.get('/',              ctrl.list)
router.get('/:id',           ctrl.detail)
router.post('/:id/receive',  vBody(receiveSchema), ctrl.receive)
router.post('/:id/putaway',  vBody(putawaySchema), ctrl.putaway)
router.post('/:id/cancel',   ctrl.cancel)

module.exports = router
