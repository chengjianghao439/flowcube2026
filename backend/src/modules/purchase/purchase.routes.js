const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./purchase.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
const vBody = schema => (req,res,next) => { const r=schema.safeParse(req.body); if(!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null}); req.body=r.data; next() }
const itemSchema = z.object({
  productId:z.number().int().positive(),
  productCode:z.string().max(50,'商品编码过长'),
  productName:z.string().max(150,'商品名称过长'),
  unit:z.string().max(20,'单位过长'),
  articleNumber:z.string().max(50,'货号过长').optional().nullable(),
  spec:z.string().max(100,'型号过长').optional().nullable(),
  color:z.string().max(30,'颜色过长').optional().nullable(),
  quantity:z.number().int('采购数量必须为整数').positive('数量必须大于0'),
  unitPrice:z.number().nonnegative(),
  remark:z.string().max(200,'备注过长').optional(),
})
const createSchema = z.object({ supplierId:z.number().int().positive('请选择供应商'), supplierName:z.string(), warehouseId:z.number().int().positive('请选择仓库'), warehouseName:z.string(), expectedDate:z.string().optional(), remark:z.string().optional(), items:z.array(itemSchema).min(1,'至少添加一条明细') })
router.use(authMiddleware)
router.get('/',             requirePermission(PERMISSIONS.PURCHASE_ORDER_VIEW), ctrl.list)
router.get('/:id',          requirePermission(PERMISSIONS.PURCHASE_ORDER_VIEW), ctrl.detail)
router.post('/',            requirePermission(PERMISSIONS.PURCHASE_ORDER_CREATE), vBody(createSchema), ctrl.create)
router.put('/:id',          requirePermission(PERMISSIONS.PURCHASE_ORDER_CREATE), vBody(createSchema), ctrl.update)
router.post('/:id/confirm', requirePermission(PERMISSIONS.PURCHASE_ORDER_CONFIRM), ctrl.confirm)
router.post('/:id/withdraw-confirm', requirePermission(PERMISSIONS.PURCHASE_ORDER_CONFIRM), ctrl.withdrawConfirm)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.PURCHASE_ORDER_CANCEL), ctrl.cancel)
router.post('/:id/close',   requirePermission(PERMISSIONS.PURCHASE_ORDER_CONFIRM), ctrl.close)
module.exports = router
