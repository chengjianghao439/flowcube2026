const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./credit-overrides.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const createSchema = z.object({
  saleOrderId: z.number().int().positive('请选择销售单'),
  reason: z.string().trim().min(1, '请填写超额原因').max(500),
  expiresAt: z.string().datetime().optional(),
})
const approvalSchema = z.object({ expectedTaskId: z.number().int().positive().optional(), reason: z.string().trim().max(500).optional() })
const rejectSchema = approvalSchema.extend({ reason: z.string().trim().min(1, '请填写驳回原因').max(300) })

router.use(authMiddleware)
router.get('/',             requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_VIEW), ctrl.list)
router.get('/:id',          requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_VIEW), ctrl.detail)
router.post('/',            requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), validateBody(createSchema), ctrl.create)
router.post('/:id/submit',  requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), ctrl.submit)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), ctrl.cancel)
// 沿用既有 apply 路由码，不增默认授权；独立审批码及岗位赋权待用户确认。
// service 再核当前业务/查看/待办权限、自批设置、仓范围与准确节点；管理员也须命中节点。
router.post('/:id/approve', requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), validateBody(approvalSchema), ctrl.approve)
router.post('/:id/reject',  requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), validateBody(rejectSchema), ctrl.reject)

module.exports = router
