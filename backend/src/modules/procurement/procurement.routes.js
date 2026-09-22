const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./procurement.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')
const { hasTooManyDecimals } = require('../../utils/qtyPrecision')

const router = Router()
const qtySetting = z.number().nonnegative().refine(value => !hasTooManyDecimals(value), '数量最多保留 2 位小数')

const generateSchema = z.object({
  window: z.number().int().positive().max(365).optional(),
  horizon: z.number().int().positive().max(365).optional(),
  warehouseId: z.number().int().positive().optional().nullable(),
  name: z.string().max(128).optional().nullable(),
  defaultLeadTime: z.number().int().min(0).max(365).optional(),
  forecastMethod: z.enum(['sma', 'wma']).optional(),
  remark: z.string().max(500).optional().nullable(),
})
const updateItemSchema = z.object({
  adjustedQty: qtySetting.optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  ignore: z.boolean().optional(),
})
const convertSchema = z.object({
  itemIds: z.array(z.number().int().positive()).min(1, '请至少勾选一行'),
  target: z.enum(['purchase', 'requisition']).optional(),
})

router.use(authMiddleware)
router.get('/purchase-policy', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_MANAGE), ctrl.purchasePolicy)
router.put('/purchase-policy', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_MANAGE), validateBody(z.object({ productId: z.number().int().positive(), supplierId: z.number().int().positive(), entryUnit: z.string().min(1).max(32), packMultiple: qtySetting.refine(value => value <= 100000000, '包装倍数超出上限'), minimumOrderQty: qtySetting.refine(value => value <= 100000000, '起订量超出上限') })), ctrl.savePurchasePolicy)
router.get('/plans', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_VIEW), ctrl.list)
router.post('/plans', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_MANAGE), validateBody(generateSchema), ctrl.generate)
router.get('/plans/:id', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_VIEW), ctrl.detail)
router.put('/plans/:id/items/:itemId', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_MANAGE), validateBody(updateItemSchema), ctrl.updateItem)
// 转采购最终产出采购单草稿，复用采购创建权限
router.post('/plans/:id/convert', requirePermission(PERMISSIONS.PURCHASE_ORDER_CREATE), validateBody(convertSchema), ctrl.convert)
router.post('/plans/:id/cancel', requirePermission(PERMISSIONS.PROCUREMENT_PLAN_MANAGE), ctrl.cancel)

module.exports = router
