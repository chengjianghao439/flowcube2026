const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./sale.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
const vBody = schema => (req,res,next) => { const r=schema.safeParse(req.body); if(!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null}); req.body=r.data; next() }
const itemSchema = z.object({
  productId:z.number().int().positive(),
  productCode:z.string(),
  productName:z.string(),
  articleNumber:z.string().optional().nullable(),
  spec:z.string().optional().nullable(),
  color:z.string().optional().nullable(),
  unit:z.string(),
  // 录入单位（文档03 Phase3）：缺省=基本单位 unit；quantity/unitPrice 视作该录入单位下的量/价，后端折算落基本单位
  entryUnit:z.string().max(20).optional().nullable(),
  quantity:z.number().int('销售数量必须为整数').positive('数量必须大于0'),
  unitPrice:z.number().positive('单价必须大于0'),
  remark:z.string().optional(),
  priceSource:z.enum(['list','default','manual']).optional(),
  resolvedPrice:z.number().positive('成交价必须大于0').optional().nullable(),
  resolvedPriceLevel:z.string().max(10).optional().nullable(),
  costPrice:z.number().nonnegative().optional().nullable(),
})
const salePhoneRule = z.string().max(11).regex(/^1\d{10}$/, '请输入正确的手机号').optional().or(z.literal(''))
const createSchema = z.object({ customerId:z.number().int().positive('请选择客户'), customerName:z.string(), warehouseId:z.number().int().positive('请选择仓库'), warehouseName:z.string(), remark:z.string().optional(), carrierId:z.number().int().positive().optional().nullable(), carrier:z.string().optional(), freightType:z.number().int().min(1).max(3).optional().nullable(), receiverName:z.string().max(5,'收货人最多 5 个字符').optional(), receiverPhone:salePhoneRule, receiverAddress:z.string().max(30,'收货地址最多 30 个字符').optional(), items:z.array(itemSchema).min(1,'至少添加一条明细') })
const reserveSchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    warehouseName: z.string(),
  })).optional(),
})
router.use(authMiddleware)
router.get('/',           requirePermission(PERMISSIONS.SALE_ORDER_VIEW), ctrl.list)
router.get('/:id',        requirePermission(PERMISSIONS.SALE_ORDER_VIEW), ctrl.detail)
router.get('/:id/reserve-preview', requirePermission(PERMISSIONS.SALE_ORDER_RESERVE), ctrl.reservePreview)
router.post('/',          requirePermission(PERMISSIONS.SALE_ORDER_CREATE), vBody(createSchema), ctrl.create)
router.put('/:id',        requirePermission(PERMISSIONS.SALE_ORDER_UPDATE), vBody(createSchema), ctrl.update)
router.put('/:id/adjust', requirePermission(PERMISSIONS.SALE_ORDER_UPDATE), vBody(createSchema), ctrl.adjust)
router.post('/:id/reserve',  requirePermission(PERMISSIONS.SALE_ORDER_RESERVE), vBody(reserveSchema), ctrl.reserve)
router.post('/:id/release',  requirePermission(PERMISSIONS.SALE_ORDER_RELEASE), ctrl.release)
router.post('/:id/ship',     requirePermission(PERMISSIONS.SALE_ORDER_SHIP), ctrl.ship)
router.post('/:id/cancel',   requirePermission(PERMISSIONS.SALE_ORDER_CANCEL), ctrl.cancel)
router.delete('/:id',        requirePermission(PERMISSIONS.SALE_ORDER_DELETE), ctrl.del)
module.exports = router
