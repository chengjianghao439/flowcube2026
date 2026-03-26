const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./racks.controller')
const { authMiddleware } = require('../../middleware/auth')

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

router.get('/active', ctrl.listActive)
router.get('/',       ctrl.list)
router.post('/scan-hint',
  vBody(z.object({
    warehouseId:   z.number().int().positive('请选择仓库'),
    rackCode:      z.string().min(1, '请填写货架编码'),
    scanRaw:       z.string().min(1, '请扫描或输入条码'),
    excludeRackId: z.number().int().positive().optional(),
  })),
  ctrl.scanHint,
)
router.get('/:id',    ctrl.detail)
router.post('/',      ctrl.create)
router.put('/:id',    ctrl.update)
router.delete('/:id', ctrl.remove)
router.post('/:id/print-label', ctrl.printLabel)

module.exports = router
