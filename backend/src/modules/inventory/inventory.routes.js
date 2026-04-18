const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./inventory.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
function vBody(schema) {
  return (req,res,next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success:false, message:r.error.errors.map(e=>e.message).join('；'), data:null })
    req.body = r.data; next()
  }
}

const changeSchema = z.object({
  productId:   z.number().int().positive('请选择商品'),
  warehouseId: z.number().int().positive('请选择仓库'),
  quantity:    z.number().positive('数量必须大于0'),
  supplierId:  z.number().int().positive().optional().nullable(),
  unitPrice:   z.number().nonnegative().optional().nullable(),
  remark:      z.string().max(500).optional(),
})

const adjustSchema = z.object({
  productId:   z.number().int().positive('请选择商品'),
  warehouseId: z.number().int().positive('请选择仓库'),
  quantity:    z.number().nonnegative('调整数量不能为负'),
  remark:      z.string().max(500).optional(),
})

router.use(authMiddleware)
router.get('/check-consistency',      requirePermission(PERMISSIONS.INVENTORY_TRACE_VIEW), ctrl.checkConsistency)
router.get('/trace/:productId',       requirePermission(PERMISSIONS.INVENTORY_TRACE_VIEW), ctrl.trace)
router.get('/overview',                requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.overview)
router.get('/containers',              requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.containers)
router.get('/containers/barcode/:bc',  requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.containerByBarcode)
router.get('/stock',                   requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.stock)
router.get('/logs',                    requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.logs)
router.post('/inbound',     requirePermission(PERMISSIONS.INVENTORY_ADJUST), vBody(changeSchema), ctrl.inbound)
router.post('/outbound',    requirePermission(PERMISSIONS.INVENTORY_ADJUST), vBody(changeSchema), ctrl.outbound)
router.post('/adjust',      requirePermission(PERMISSIONS.INVENTORY_ADJUST), vBody(adjustSchema), ctrl.adjust)
router.put('/containers/:containerId/location',
  requirePermission(PERMISSIONS.INVENTORY_CONTAINER_MOVE),
  vBody(z.object({ locationId: z.number().int().positive('locationId 必须为正整数') })),
  ctrl.assignContainerLocation
)
router.post('/containers/:id/split',
  requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT),
  vBody(z.object({
    qty: z.number().positive('拆分数量须大于 0'),
    remark: z.string().max(500).optional(),
    printLabel: z.boolean().optional(),
  })),
  ctrl.splitContainer,
)

module.exports = router
