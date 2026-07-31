const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./procurement.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
const vBody = schema => (req, res, next) => { const r = schema.safeParse(req.body); if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null }); req.body = r.data; next() }

const generateSchema = z.object({
  window: z.number().int().positive().max(365).optional(),
  horizon: z.number().int().positive().max(365).optional(),
  warehouseId: z.number().int().positive().optional().nullable(),
  name: z.string().max(128).optional().nullable(),
  defaultLeadTime: z.number().int().min(0).max(365).optional(),
  remark: z.string().max(500).optional().nullable(),
})
const updateItemSchema = z.object({
  adjustedQty: z.number().nonnegative().optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  ignore: z.boolean().optional(),
})
const convertSchema = z.object({
  itemIds: z.array(z.number().int().positive()).min(1, '请至少勾选一行'),
  target: z.enum(['purchase', 'requisition']).optional(),
})

router.use(authMiddleware)
router.get('/plans', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_VIEW), ctrl.list)
router.post('/plans', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_MANAGE), vBody(generateSchema), ctrl.generate)
router.get('/plans/:id', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_VIEW), ctrl.detail)
router.put('/plans/:id/items/:itemId', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_MANAGE), vBody(updateItemSchema), ctrl.updateItem)
// 转采购最终产出采购单草稿，复用采购创建权限
router.post('/plans/:id/convert', requirePermission(PERMISSIONS.PURCHASE_ORDER_CREATE), vBody(convertSchema), ctrl.convert)
router.post('/plans/:id/cancel', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_MANAGE), ctrl.cancel)

module.exports = router
