const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./inventory.controller')
const { authMiddleware } = require('../../middleware/auth')

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
router.get('/check-consistency',      ctrl.checkConsistency)
router.get('/trace/:productId',       ctrl.trace)
router.get('/overview',                ctrl.overview)
router.get('/containers',              ctrl.containers)
router.get('/containers/barcode/:bc',  ctrl.containerByBarcode)
router.get('/stock',                   ctrl.stock)
router.get('/logs',                    ctrl.logs)
router.post('/inbound',     vBody(changeSchema), ctrl.inbound)
router.post('/outbound',    vBody(changeSchema), ctrl.outbound)
router.post('/adjust',      vBody(adjustSchema), ctrl.adjust)
router.put('/containers/:containerId/location',
  vBody(z.object({ locationId: z.number().int().positive('locationId 必须为正整数') })),
  ctrl.assignContainerLocation
)

module.exports = router
