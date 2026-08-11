const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./fixed-assets.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { companyScope } = require('../../middleware/companyScope')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const createSchema = z.object({
  assetName: z.string().min(1, '请填写资产名称').max(100),
  category: z.string().max(30).optional().nullable(),
  departmentId: z.number().int().positive().optional().nullable(),
  departmentName: z.string().max(80).optional().nullable(),
  acquireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请填写有效的购置日期'),
  originalCost: z.number().positive('原值必须大于 0'),
  residualRate: z.number().min(0).max(0.9999).optional(),
  usefulMonths: z.number().int().positive('使用年限必须为正整数').max(600),
  remark: z.string().max(300).optional().nullable(),
})
const deprSchema = z.object({ period: z.string().regex(/^\d{6}$/, '期间格式 YYYYMM').optional() })
const disposeSchema = z.object({
  disposeType: z.number().int().min(1).max(2),
  disposeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请填写处置日期'),
  income: z.number().min(0).optional(),
  expense: z.number().min(0).optional(),
  remark: z.string().max(300).optional().nullable(),
})

router.use(authMiddleware)
router.use(companyScope)
router.get('/',            requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), ctrl.list)
router.get('/summary',     requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), ctrl.summary)
router.get('/:id',         requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), ctrl.detail)
router.post('/',           requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), validateBody(createSchema), ctrl.create)
router.post('/depreciation/run', requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), validateBody(deprSchema), ctrl.runDepreciation)
router.post('/:id/dispose', requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), validateBody(disposeSchema), ctrl.dispose)

module.exports = router
