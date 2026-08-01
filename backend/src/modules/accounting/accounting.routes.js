/**
 * 会计核算路由（文档 10 · Phase 0）
 * 挂载点 /api/accounting；本期只有科目子路由 /accounts/*。
 * 后续 Phase 在此追加 /vouchers、/ledger 等子路由，不改挂载点。
 * 会计数据敏感：每个接口都要 requirePermission，不走「登录即可」例外。
 */
const { Router } = require('express')
const { z }      = require('zod')
const ctrl       = require('./accounting.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({
      success: false,
      message: r.error.errors.map(e => e.message).join('；'),
      data: null,
    })
    req.body = r.data
    next()
  }
}

// ── 科目表 /api/accounting/accounts ─────────────────────────────────────
const accounts = Router()

const createAccountSchema = z.object({
  code:       z.string().min(1, '科目编码不能为空').max(20),
  name:       z.string().min(1, '科目名称不能为空').max(60),
  category:   z.number().int().min(1).max(6),
  balanceDir: z.number().int().min(1).max(2).optional(),
  parentId:   z.number().int().positive().optional().nullable(),
  auxType:    z.number().int().min(0).max(1).optional(),
  sortOrder:  z.number().int().optional(),
  remark:     z.string().max(300).optional().nullable(),
})

const updateAccountSchema = z.object({
  name:       z.string().min(1, '科目名称不能为空').max(60).optional(),
  category:   z.number().int().min(1).max(6).optional(),
  balanceDir: z.number().int().min(1).max(2).optional(),
  auxType:    z.number().int().min(0).max(1).optional(),
  sortOrder:  z.number().int().optional(),
  remark:     z.string().max(300).optional().nullable(),
})

accounts.get('/tree',  requirePermission(PERMISSIONS.ACCOUNTING_ACCOUNT_VIEW), ctrl.accountTree)
accounts.get('/flat',  requirePermission(PERMISSIONS.ACCOUNTING_ACCOUNT_VIEW), ctrl.accountFlat)
accounts.get('/:id',   requirePermission(PERMISSIONS.ACCOUNTING_ACCOUNT_VIEW), ctrl.accountDetail)
accounts.post('/',            requirePermission(PERMISSIONS.ACCOUNTING_ACCOUNT_MANAGE), vBody(createAccountSchema), ctrl.accountCreate)
accounts.put('/:id',          requirePermission(PERMISSIONS.ACCOUNTING_ACCOUNT_MANAGE), vBody(updateAccountSchema), ctrl.accountUpdate)
accounts.delete('/:id',       requirePermission(PERMISSIONS.ACCOUNTING_ACCOUNT_MANAGE), ctrl.accountRemove)
accounts.patch('/:id/status', requirePermission(PERMISSIONS.ACCOUNTING_ACCOUNT_MANAGE), vBody(z.object({ isActive: z.boolean() })), ctrl.accountToggle)

router.use('/accounts', accounts)

// ── 记账凭证 /api/accounting/vouchers ───────────────────────────────────
const vouchers = Router()

const manualVoucherSchema = z.object({
  voucherDate: z.string().min(8, '记账日期必填'),
  summary:     z.string().max(200).optional().nullable(),
  entries: z.array(z.object({
    accountId: z.number().int().positive(),
    direction: z.number().int().min(1).max(2),
    amount:    z.number().positive(),
    summary:   z.string().max(200).optional().nullable(),
    auxType:   z.number().int().min(0).max(1).optional(),
    auxId:     z.number().int().positive().optional().nullable(),
    auxName:   z.string().max(100).optional().nullable(),
  })).min(2, '至少两条分录'),
})

vouchers.get('/',               requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_VIEW), ctrl.voucherList)
vouchers.get('/reconciliation', requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_VIEW), ctrl.voucherReconciliation)
vouchers.get('/export',         requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_EXPORT), ctrl.voucherExport)
vouchers.get('/:id',            requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_VIEW), ctrl.voucherDetail)
vouchers.post('/generate',      requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), vBody(z.object({ period: z.string().max(6).optional().nullable() })), ctrl.voucherGenerate)
vouchers.post('/',              requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), vBody(manualVoucherSchema), ctrl.voucherCreateManual)
vouchers.post('/:id/reverse',   requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), ctrl.voucherReverse)
vouchers.delete('/:id',         requirePermission(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE), ctrl.voucherRemove)

router.use('/vouchers', vouchers)

module.exports = router
