const { Router } = require('express')
const { z } = require('zod')
const { validateBody } = require('../../utils/route')
const ctrl = require('./plastic-boxes.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

router.get('/',            requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.list)
router.post('/',           requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT), validateBody(z.object({
  productId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  locationId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(500).optional(),
})), ctrl.create)
router.get('/:id',         requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.detail)
router.get('/:id/movements', requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.movements)
// 重复打印塑料盒条码：只读业务（入队打印、不改库存），与库位/货架标签同口径用查看权限
router.post('/:id/print-label', requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.printLabel)
router.delete('/:id',      requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT), ctrl.remove)

module.exports = router
