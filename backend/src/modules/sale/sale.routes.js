const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./sale.controller')
const { authMiddleware } = require('../../middleware/auth')
const router = Router()
const vBody = schema => (req,res,next) => { const r=schema.safeParse(req.body); if(!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null}); req.body=r.data; next() }
const itemSchema = z.object({
  productId:z.number().int().positive(),
  productCode:z.string(),
  productName:z.string(),
  unit:z.string(),
  quantity:z.number().positive('数量必须大于0'),
  unitPrice:z.number().nonnegative(),
  remark:z.string().optional(),
  priceSource:z.enum(['list','default','manual']).optional(),
  resolvedPrice:z.number().nonnegative().optional().nullable(),
  resolvedPriceLevel:z.string().max(10).optional().nullable(),
  costPrice:z.number().nonnegative().optional().nullable(),
})
const salePhoneRule = z.string().max(11).regex(/^1\d{10}$/, '请输入正确的手机号').optional().or(z.literal(''))
const createSchema = z.object({ customerId:z.number().int().positive('请选择客户'), customerName:z.string(), warehouseId:z.number().int().positive('请选择仓库'), warehouseName:z.string(), remark:z.string().max(30,'备注最多 30 个字符').optional(), carrierId:z.number().int().positive().optional().nullable(), carrier:z.string().optional(), freightType:z.number().int().min(1).max(3).optional().nullable(), receiverName:z.string().max(5,'收货人最多 5 个字符').optional(), receiverPhone:salePhoneRule, receiverAddress:z.string().max(30,'收货地址最多 30 个字符').optional(), items:z.array(itemSchema).min(1,'至少添加一条明细') })
router.use(authMiddleware)
router.get('/',           ctrl.list)
router.get('/:id',        ctrl.detail)
router.post('/',          vBody(createSchema), ctrl.create)
router.put('/:id',        vBody(createSchema), ctrl.update)
router.post('/:id/reserve',  ctrl.reserve)
router.post('/:id/release',  ctrl.release)
router.post('/:id/ship',     ctrl.ship)
router.post('/:id/cancel',   ctrl.cancel)
router.delete('/:id',        ctrl.del)
module.exports = router
