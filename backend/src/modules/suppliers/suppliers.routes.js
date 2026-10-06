const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./suppliers.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { SETTLEMENT_TYPE, MONTHLY_TERMS_OPTIONS } = require('../../constants/settlementType')
const { pool } = require('../../config/db')
const { validateBody } = require('../../utils/route')
const { partyProfileSchema } = require('../../utils/partyProfile')

const VALID_SETTLEMENT_TYPES = Object.values(SETTLEMENT_TYPE)

const router = Router()

const base = partyProfileSchema('供应商').extend({
  code:    z.string().min(1,'编码不能为空').max(30),
  email:   z.string().email('邮箱格式不正确').max(100).optional().or(z.literal('')),
  settlementType: z.number().int().refine(v => VALID_SETTLEMENT_TYPES.includes(v), '结算方式不合法').optional(),
  // 账期只对月结生效；其余结算方式服务端会强制归零，这里不拦
  paymentTermsDays: z.number().int().refine(
    v => v === 0 || MONTHLY_TERMS_OPTIONS.includes(v),
    `月结账期只能是 ${MONTHLY_TERMS_OPTIONS.join(' / ')} 天`,
  ).optional(),
  // 采购提前期（天），用于采购计划预测
  leadTimeDays: z.number().int().min(0).max(365, '提前期最多 365 天').optional(),
})

const { generateMasterCode } = require('../../utils/codeGenerator')
const { successResponse } = require('../../utils/response')
router.use(authMiddleware)
router.get('/next-code', async (req, res, next) => {
  try {
    const code = await generateMasterCode(pool, 'SUP', 'supply_suppliers')
    return successResponse(res, { code }, '生成成功')
  } catch (e) { next(e) }
})
router.get('/active', requirePermission(PERMISSIONS.SUPPLIER_VIEW), ctrl.listActive)
router.get('/',       requirePermission(PERMISSIONS.SUPPLIER_VIEW), ctrl.list)
router.get('/:id',    requirePermission(PERMISSIONS.SUPPLIER_VIEW), ctrl.detail)
router.post('/',      requirePermission(PERMISSIONS.SUPPLIER_CREATE), validateBody(base.omit({ code: true })), ctrl.create)
router.put('/:id',    requirePermission(PERMISSIONS.SUPPLIER_UPDATE), validateBody(base.extend({ code: base.shape.code.optional(), isActive: z.boolean() })), ctrl.update)
router.delete('/:id', requirePermission(PERMISSIONS.SUPPLIER_DELETE), ctrl.remove)

module.exports = router
