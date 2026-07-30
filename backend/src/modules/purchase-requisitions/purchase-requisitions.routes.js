const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./purchase-requisitions.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.body = r.data; next()
  }
}

const itemSchema = z.object({
  productId: z.number().int().positive('请选择商品'),
  quantity: z.number().positive('请购数量必须大于 0'),
  estimatedPrice: z.number().nonnegative().nullable().optional(),
  suggestedSupplierId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(200).optional(),
})
const createSchema = z.object({
  title: z.string().max(100).optional(),
  warehouseId: z.number().int().positive('请选择期望入库仓'),
  expectedDate: z.string().nullable().optional(),
  source: z.enum(['manual', 'replenishment']).optional(),
  items: z.array(itemSchema).min(1, '请至少填写一条请购明细'),
  remark: z.string().max(300).optional(),
})
const updateSchema = z.object({
  title: z.string().max(100).optional(),
  warehouseId: z.number().int().positive().optional(),
  expectedDate: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, '请至少填写一条请购明细').optional(),
  remark: z.string().max(300).optional(),
})
const rejectSchema = z.object({ reason: z.string().min(1, '请填写驳回原因').max(300) })
const convertSchema = z.object({
  lines: z.array(z.object({
    requisitionItemId: z.number().int().positive(),
    quantity: z.number().positive('转采购数量必须大于 0'),
    supplierId: z.number().int().positive('每行转采购必须指定供应商'),
    supplierName: z.string().optional(),
    unitPrice: z.number().nonnegative('采购单价不能为负'),
  })).min(1, '请至少选择一行转采购'),
})

router.use(authMiddleware)
router.get('/',              requirePermission(PERMISSIONS.PURCHASE_REQUISITION_VIEW),    ctrl.list)
router.get('/:id',           requirePermission(PERMISSIONS.PURCHASE_REQUISITION_VIEW),    ctrl.detail)
router.post('/',             requirePermission(PERMISSIONS.PURCHASE_REQUISITION_CREATE),  vBody(createSchema), ctrl.create)
router.put('/:id',           requirePermission(PERMISSIONS.PURCHASE_REQUISITION_CREATE),  vBody(updateSchema), ctrl.update)
router.post('/:id/submit',   requirePermission(PERMISSIONS.PURCHASE_REQUISITION_CREATE),  ctrl.submit)
router.post('/:id/withdraw', requirePermission(PERMISSIONS.PURCHASE_REQUISITION_CREATE),  ctrl.withdraw)
router.post('/:id/cancel',   requirePermission(PERMISSIONS.PURCHASE_REQUISITION_CREATE),  ctrl.cancel)
router.post('/:id/approve',  requirePermission(PERMISSIONS.PURCHASE_REQUISITION_APPROVE), ctrl.approve)
router.post('/:id/reject',   requirePermission(PERMISSIONS.PURCHASE_REQUISITION_APPROVE), vBody(rejectSchema), ctrl.reject)
router.post('/:id/convert',  requirePermission(PERMISSIONS.PURCHASE_REQUISITION_CONVERT), vBody(convertSchema), ctrl.convert)

module.exports = router
