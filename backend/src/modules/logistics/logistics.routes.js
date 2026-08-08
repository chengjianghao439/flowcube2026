const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./logistics.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const trackingSchema = z.object({
  trackingNo: z.string().min(1, '快递单号不能为空').max(60),
})
const voidSchema = z.object({
  reason: z.string().max(200).optional().or(z.literal('')),
})
const billSchema = z.object({
  carrierId: z.number().int().positive(),
  trackingNo: z.string().min(1, '快递单号不能为空').max(60),
  waybillId: z.number().int().positive().optional(),
  billPeriod: z.string().regex(/^\d{4}-\d{2}$/, '账期格式应为 YYYY-MM').optional().or(z.literal('')),
  actualFreight: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
  source: z.string().max(20).optional(),
})
const settlementSchema = z.object({
  carrierId: z.number().int().positive(),
  billPeriod: z.string().regex(/^\d{4}-\d{2}$/, '账期格式应为 YYYY-MM'),
})

router.use(authMiddleware)

// ─── 运费对账（注意放在 /:id 之前，避免 "bills"/"settlements" 被当作 id）──────────
router.get('/freight/bills', requirePermission(PERMISSIONS.LOGISTICS_FREIGHT_RECONCILE), ctrl.listBills)
router.post('/freight/bills', requirePermission(PERMISSIONS.LOGISTICS_FREIGHT_RECONCILE), validateBody(billSchema), ctrl.createBill)
router.get('/freight/settlements', requirePermission(PERMISSIONS.LOGISTICS_FREIGHT_RECONCILE), ctrl.listSettlements)
router.post('/freight/settlements', requirePermission(PERMISSIONS.LOGISTICS_FREIGHT_RECONCILE), validateBody(settlementSchema), ctrl.generateSettlement)

// ─── 运单 ─────────────────────────────────────────────────────────────────────
router.get('/', requirePermission(PERMISSIONS.LOGISTICS_VIEW), ctrl.list)
router.get('/:id', requirePermission(PERMISSIONS.LOGISTICS_VIEW), ctrl.detail)
router.get('/:id/track', requirePermission(PERMISSIONS.LOGISTICS_VIEW), ctrl.track)
router.put('/:id/tracking', requirePermission(PERMISSIONS.LOGISTICS_MANAGE), validateBody(trackingSchema), ctrl.setTracking)
router.post('/:id/retry', requirePermission(PERMISSIONS.LOGISTICS_MANAGE), ctrl.retry)
router.post('/:id/void', requirePermission(PERMISSIONS.LOGISTICS_MANAGE), validateBody(voidSchema), ctrl.voidOne)

module.exports = router
