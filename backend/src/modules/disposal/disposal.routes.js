const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./disposal.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const itemSchema = z.object({
  productId: z.number().int().positive('请选择商品'),
  quantity: z.number().positive('处置数量必须大于 0'),
  disposeType: z.number().int().min(1).max(3, '处置方式：1降价促销 2退货供应商 3报废'),
  remark: z.string().max(300).optional().nullable(),
})

const createSchema = z.object({
  warehouseId: z.number().int().positive('请选择仓库'),
  warehouseName: z.string().min(1).max(100),
  remark: z.string().max(500).optional().nullable(),
  items: z.array(itemSchema).min(1, '至少添加一条处置明细'),
})

const updateSchema = z.object({
  warehouseId: z.number().int().positive('请选择仓库'),
  warehouseName: z.string().min(1).max(100),
  remark: z.string().max(500).optional().nullable(),
  items: z.array(itemSchema).min(1, '至少添加一条处置明细'),
})

const rejectSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
})

router.use(authMiddleware)
router.get('/suggestions',  requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.suggestions)
// 静态子路径须在 /:id 之前注册，否则 /suggestions 会被 /:id 误匹配
router.get('/',             requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.list)
router.get('/:id',          requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.detail)
router.post('/',            requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), validateBody(createSchema), ctrl.create)
router.put('/:id',          requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), validateBody(updateSchema), ctrl.update)
router.post('/:id/submit',  requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), ctrl.submit)
router.post('/:id/approve', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE), ctrl.approve)
router.post('/:id/reject',  requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE), validateBody(rejectSchema), ctrl.reject)
router.post('/:id/dispose', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_EXECUTE), ctrl.dispose)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), ctrl.cancel)

module.exports = router
