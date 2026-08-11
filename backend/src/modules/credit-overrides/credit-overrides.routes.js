const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./credit-overrides.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const createSchema = z.object({
  saleOrderId: z.number().int().positive('请选择销售单'),
  reason: z.string().max(500).optional(),
})
const rejectSchema = z.object({ reason: z.string().min(1, '请填写驳回原因').max(300) })

router.use(authMiddleware)
router.get('/',             requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_VIEW), ctrl.list)
router.get('/:id',          requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_VIEW), ctrl.detail)
router.post('/',            requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), validateBody(createSchema), ctrl.create)
router.post('/:id/submit',  requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), ctrl.submit)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), ctrl.cancel)
// 审批入口用 apply 码（业务相关用户即可），真正「谁是审批人」由引擎按流程配置硬校验
// （超管 roleId=1 恒可代批）。不给 apply 权限的只读角色即使有 view 也批不了。
router.post('/:id/approve', requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), ctrl.approve)
router.post('/:id/reject',  requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY), validateBody(rejectSchema), ctrl.reject)

module.exports = router
