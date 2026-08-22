const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { validateBody, validateParams } = require('../../utils/route')
const { PERMISSIONS } = require('../../constants/permissions')
const { z } = require('zod')
const ctrl = require('./price-change.controller')

const router = require('express').Router()

const createSchema = z.object({
  productId: z.number().int().positive('请选择商品'),
  priceType: z.enum(['sale', 'cost', 'a', 'b', 'c', 'd']).default('sale'),
  newPrice: z.number().nonnegative('新价格必须大于等于 0'),
  reason: z.string().max(255).optional(),
})

const idParamSchema = z.object({ id: z.coerce.number().int().positive() })

router.use(authMiddleware)

router.get('/',            requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.list)
router.get('/:id',         requirePermission(PERMISSIONS.PRODUCT_VIEW), validateParams(idParamSchema), ctrl.detail)
router.post('/',           requirePermission(PERMISSIONS.PRODUCT_UPDATE), validateBody(createSchema), ctrl.create)
router.post('/:id/submit', requirePermission(PERMISSIONS.PRODUCT_UPDATE), validateParams(idParamSchema), ctrl.submit)
router.post('/:id/approve', requirePermission(PERMISSIONS.APPROVAL_TASK_VIEW), validateParams(idParamSchema), ctrl.approve)
router.post('/:id/reject', requirePermission(PERMISSIONS.APPROVAL_TASK_VIEW), validateParams(idParamSchema), validateBody(z.object({ reason: z.string().max(255).optional() })), ctrl.reject)
router.post('/:id/cancel', requirePermission(PERMISSIONS.PRODUCT_UPDATE), validateParams(idParamSchema), ctrl.cancel)

module.exports = router
