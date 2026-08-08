const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./customers.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { SETTLEMENT_TYPE, MONTHLY_TERMS_OPTIONS } = require('../../constants/settlementType')
const { pool } = require('../../config/db')
const { validateBody } = require('../../utils/route')
const router = Router()
const VALID_SETTLEMENT_TYPES = Object.values(SETTLEMENT_TYPE)
const phoneRule = z.string().max(11).regex(/^1\d{10}$/, '请输入正确的手机号').optional().or(z.literal(''))
const base = z.object({
  code:z.string().min(1).max(30),
  name:z.string().min(1,'名称不能为空').max(20,'客户名称最多 20 个字符'),
  contact:z.string().max(5,'联系人最多 5 个字符').optional(),
  phone:phoneRule,
  email:z.string().email().max(100).optional().or(z.literal('')),
  address:z.string().max(30,'地址最多 30 个字符').optional(),
  remark:z.string().max(30,'备注最多 30 个字符').optional(),
  settlementType:z.number().int().refine(v => VALID_SETTLEMENT_TYPES.includes(v), '结算方式不合法').optional(),
  // 账期只对月结生效；其余结算方式服务端会强制归零，这里不拦
  paymentTermsDays:z.number().int().refine(
    v => v === 0 || MONTHLY_TERMS_OPTIONS.includes(v),
    `月结账期只能是 ${MONTHLY_TERMS_OPTIONS.join(' / ')} 天`,
  ).optional(),
  // 授信额度：null=不启用信控；>=0=启用（0=现款现货）
  creditLimit:z.number().nonnegative('授信额度不能为负').nullable().optional(),
})
const { generateMasterCode } = require('../../utils/codeGenerator')
const { successResponse } = require('../../utils/response')
router.use(authMiddleware)
router.get('/next-code', async (req, res, next) => {
  try {
    const code = await generateMasterCode(pool, 'CUS', 'sale_customers')
    return successResponse(res, { code }, '生成成功')
  } catch (e) { next(e) }
})
router.get('/active', requirePermission(PERMISSIONS.CUSTOMER_VIEW), ctrl.listActive)
router.get('/',       requirePermission(PERMISSIONS.CUSTOMER_VIEW), ctrl.list)
router.get('/:id',    requirePermission(PERMISSIONS.CUSTOMER_VIEW), ctrl.detail)
router.get('/:id/credit', requirePermission(PERMISSIONS.SALE_CREDIT_VIEW), ctrl.credit)
router.post('/',      requirePermission(PERMISSIONS.CUSTOMER_CREATE), validateBody(base), ctrl.create)
router.put('/:id',    requirePermission(PERMISSIONS.CUSTOMER_UPDATE), validateBody(base.omit({ code:true }).extend({ isActive:z.boolean() })), ctrl.update)
router.delete('/:id', requirePermission(PERMISSIONS.CUSTOMER_DELETE), ctrl.remove)
module.exports = router
