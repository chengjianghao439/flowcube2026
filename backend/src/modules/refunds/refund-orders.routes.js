const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./refund-orders.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

// 跨期补录申请（2026-09-26 一致性审查 · 任务 7）：必须在 schema 里声明，否则 validateBody
// 用 parse 结果整体替换 req.body 时会把这两个字段剥掉，controller 读到的恒为 undefined，
// 申请入口形同虚设。权限同理不在路由级卡（会让没补录权限的出纳连正常退款都做不了），
// 只有显式传 backfillRequest=true 时才在 service 侧条件校验 finance.period.backfill。
const backfillFields = {
  backfillRequest: z.boolean().optional(),
  backfillReason: z.string().max(300).optional(),
}

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
router.post('/:id/execute', requirePermission(PERMISSIONS.REFUND_ORDER_EXECUTE), validateBody(z.object(backfillFields)), ctrl.execute)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.REFUND_ORDER_CREATE), ctrl.cancel)

module.exports = router
