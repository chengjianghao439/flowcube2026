const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./refund-orders.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const createSchema = z.object({
  saleOrderId: z.number().int().positive().optional().nullable(),
  saleOrderNo: z.string().min(1).max(30).optional().nullable(),
  amount: z.number().positive('退款金额必须大于 0'),
  accountId: z.number().int().positive('请选择退款账户').optional().nullable(),
  refundDate: z.string().min(8).optional().nullable(),
  remark: z.string().max(500).optional().nullable(),
}).refine(d => (d.saleOrderId || d.saleOrderNo), { message: '请选择关联销售单', path: ['saleOrderNo'] })

router.use(authMiddleware)
router.get('/',         requirePermission(PERMISSIONS.REFUND_ORDER_VIEW), ctrl.list)
router.get('/:id',      requirePermission(PERMISSIONS.REFUND_ORDER_VIEW), ctrl.detail)
router.post('/',        requirePermission(PERMISSIONS.REFUND_ORDER_CREATE), validateBody(createSchema), ctrl.create)
router.post('/:id/submit',  requirePermission(PERMISSIONS.REFUND_ORDER_CREATE), ctrl.submit)
router.post('/:id/execute', requirePermission(PERMISSIONS.REFUND_ORDER_EXECUTE), ctrl.execute)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.REFUND_ORDER_CREATE), ctrl.cancel)

module.exports = router
