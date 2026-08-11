const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./hr.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { companyScope } = require('../../middleware/companyScope')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const employeeSchema = z.object({
  empNo: z.string().max(30).optional(),
  name: z.string().min(1, '请填写员工姓名').max(50),
  idCardNo: z.string().max(20).optional().nullable(),
  departmentId: z.number().int().positive().optional().nullable(),
  departmentName: z.string().max(80).optional().nullable(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})
const payrollSchema = z.object({ period: z.string().regex(/^\d{6}$/, '期间格式 YYYYMM') })
const paySchema = z.object({ paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })

router.use(authMiddleware)
router.use(companyScope)
// 员工
router.get('/employees',       requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), ctrl.employeeList)
router.post('/employees',      requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), validateBody(employeeSchema), ctrl.employeeCreate)
// 工资单
router.get('/payrolls',        requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), ctrl.payrollList)
router.post('/payrolls',       requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), validateBody(payrollSchema), ctrl.payrollCreate)
router.post('/payrolls/:id/calculate', requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), ctrl.payrollCalculate)
router.post('/payrolls/:id/pay', requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), validateBody(paySchema), ctrl.payrollPay)

module.exports = router
