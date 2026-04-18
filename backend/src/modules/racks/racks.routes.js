const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./racks.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

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

router.get('/active', requirePermission(PERMISSIONS.RACK_VIEW), ctrl.listActive)
router.get('/',       requirePermission(PERMISSIONS.RACK_VIEW), ctrl.list)
router.post('/scan-hint',
  requirePermission(PERMISSIONS.RACK_VIEW),
  vBody(z.object({
    warehouseId:   z.number().int().positive('请选择仓库'),
    rackCode:      z.string().min(1, '请填写货架编码'),
    scanRaw:       z.string().min(1, '请扫描或输入条码'),
    excludeRackId: z.number().int().positive().optional(),
  })),
  ctrl.scanHint,
)
router.get('/:id',    requirePermission(PERMISSIONS.RACK_VIEW), ctrl.detail)
router.post('/',      requirePermission(PERMISSIONS.RACK_CREATE), ctrl.create)
router.put('/:id',    requirePermission(PERMISSIONS.RACK_UPDATE), ctrl.update)
router.delete('/:id', requirePermission(PERMISSIONS.RACK_DELETE), ctrl.remove)
router.post('/:id/print-label', requirePermission(PERMISSIONS.RACK_PRINT_LABEL), ctrl.printLabel)

module.exports = router
