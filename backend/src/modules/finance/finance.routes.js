const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./finance.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()
router.use(authMiddleware)

const vParams = s => (req,res,next) => {
  const r = s.safeParse(req.params)
  if (!r.success) return res.status(400).json({ success:false, message:r.error.errors.map(e=>e.message).join('；'), data:null })
  req.params = r.data; next()
}
const idParam = z.object({ id: z.coerce.number().int().positive('id 必须为正整数') })

const accountBody = z.object({
  name: z.string().min(1, '账户名称不能为空').max(80),
  type: z.number().int().min(1).max(5),
  accountNo: z.string().max(60).optional().or(z.literal('')),
  bankName: z.string().max(80).optional().or(z.literal('')),
  holder: z.string().max(80).optional().or(z.literal('')),
  openingBalance: z.number().optional(),
  sortOrder: z.number().int().optional(),
  remark: z.string().max(300).optional().or(z.literal('')),
})

// 顺序要求：静态路径注册在 '/:id' 之前，否则会被当成 id 吃掉
router.get('/dashboard',             requirePermission(PERMISSIONS.FINANCE_ACCOUNT_VIEW), ctrl.dashboard)
router.get('/accounts/active',       requirePermission(PERMISSIONS.FINANCE_ACCOUNT_VIEW), ctrl.active)
router.get('/accounts/transactions', requirePermission(PERMISSIONS.FINANCE_ACCOUNT_VIEW), ctrl.transactions)
router.get('/accounts/consistency',  requirePermission(PERMISSIONS.FINANCE_ACCOUNT_VIEW), ctrl.consistency)
router.get('/accounts',              requirePermission(PERMISSIONS.FINANCE_ACCOUNT_VIEW), ctrl.list)
router.get('/accounts/:id',          requirePermission(PERMISSIONS.FINANCE_ACCOUNT_VIEW), vParams(idParam), ctrl.detail)
router.get('/accounts/:id/transactions', requirePermission(PERMISSIONS.FINANCE_ACCOUNT_VIEW), vParams(idParam), ctrl.transactions)

router.post('/accounts',      requirePermission(PERMISSIONS.FINANCE_ACCOUNT_CREATE), validateBody(accountBody), ctrl.create)
router.put('/accounts/:id',   requirePermission(PERMISSIONS.FINANCE_ACCOUNT_UPDATE), vParams(idParam),
  validateBody(accountBody.extend({ isActive: z.boolean(), openingBalance: z.number().optional() })), ctrl.update)
router.delete('/accounts/:id', requirePermission(PERMISSIONS.FINANCE_ACCOUNT_DELETE), vParams(idParam), ctrl.remove)

// 余额调整单独授权：它能直接改变账面资金，属于高敏动作
router.post('/accounts/:id/adjust', requirePermission(PERMISSIONS.FINANCE_ACCOUNT_ADJUST), vParams(idParam), validateBody(z.object({
  targetBalance: z.number('请填写调整后的账户余额'),
  happenedAt: z.string().optional(),
  remark: z.string().max(300).optional().or(z.literal('')),
})), ctrl.adjust)


// ── 费用报销 ──────────────────────────────────────────────────────────────────
const itemRule = z.array(z.object({
  categoryId: z.number().int().positive('请选择费用类别'),
  amount: z.number().positive('明细金额必须大于 0'),
  happenedAt: z.string().min(1, '请填写费用发生日期'),
  description: z.string().max(200).optional().or(z.literal('')),
})).min(1, '请至少填写一条费用明细')

// 静态路径先注册，避免被 '/:id' 吃掉
router.get('/expense-categories', requirePermission(PERMISSIONS.FINANCE_EXPENSE_VIEW), ctrl.categoryList)
router.post('/expense-categories', requirePermission(PERMISSIONS.FINANCE_EXPENSE_CATEGORY_MANAGE), validateBody(z.object({
  name: z.string().min(1, '类别名称不能为空').max(50),
  sortOrder: z.number().int().optional(),
  remark: z.string().max(200).optional().or(z.literal('')),
})), ctrl.categoryCreate)
router.put('/expense-categories/:id', requirePermission(PERMISSIONS.FINANCE_EXPENSE_CATEGORY_MANAGE), vParams(idParam), validateBody(z.object({
  name: z.string().min(1, '类别名称不能为空').max(50),
  isActive: z.boolean(),
  sortOrder: z.number().int().optional(),
  remark: z.string().max(200).optional().or(z.literal('')),
})), ctrl.categoryUpdate)
router.delete('/expense-categories/:id', requirePermission(PERMISSIONS.FINANCE_EXPENSE_CATEGORY_MANAGE), vParams(idParam), ctrl.categoryDelete)

router.get('/expense-claims',      requirePermission(PERMISSIONS.FINANCE_EXPENSE_VIEW), ctrl.expenseList)
router.get('/expense-claims/:id',  requirePermission(PERMISSIONS.FINANCE_EXPENSE_VIEW), vParams(idParam), ctrl.expenseDetail)
router.post('/expense-claims',     requirePermission(PERMISSIONS.FINANCE_EXPENSE_CREATE), validateBody(z.object({
  title: z.string().max(100).optional().or(z.literal('')),
  items: itemRule,
  remark: z.string().max(300).optional().or(z.literal('')),
})), ctrl.expenseCreate)
router.put('/expense-claims/:id',  requirePermission(PERMISSIONS.FINANCE_EXPENSE_UPDATE), vParams(idParam), validateBody(z.object({
  title: z.string().max(100).optional().or(z.literal('')),
  items: itemRule.optional(),
  remark: z.string().max(300).optional().or(z.literal('')),
})), ctrl.expenseUpdate)

router.post('/expense-claims/:id/submit',   requirePermission(PERMISSIONS.FINANCE_EXPENSE_CREATE), vParams(idParam), ctrl.expenseSubmit)
router.post('/expense-claims/:id/withdraw', requirePermission(PERMISSIONS.FINANCE_EXPENSE_CREATE), vParams(idParam), ctrl.expenseWithdraw)
router.post('/expense-claims/:id/cancel',   requirePermission(PERMISSIONS.FINANCE_EXPENSE_CREATE), vParams(idParam), ctrl.expenseCancel)
// 审批与付款是内控的两道口子，各自独立授权
router.post('/expense-claims/:id/approve',  requirePermission(PERMISSIONS.FINANCE_EXPENSE_APPROVE), vParams(idParam), ctrl.expenseApprove)
router.post('/expense-claims/:id/reject',   requirePermission(PERMISSIONS.FINANCE_EXPENSE_APPROVE), vParams(idParam), validateBody(z.object({
  reason: z.string().min(1, '请填写驳回原因').max(300),
})), ctrl.expenseReject)
// 跨期补录（2026-09-26 一致性审查 · 任务 7 收口）：报销付款是三条资金入口里原先唯一没有
// 期间闸门的，补上闸门后同样需要「先审批、后动账」的申请入口。
// 必须在 schema 里声明 backfill 两个字段——validateBody 用 schema.parse 的结果**整体替换**
// req.body，未声明的字段会被 zod 剥掉，controller 读到的 backfillRequest 恒为 undefined，
// 申请入口形同虚设。权限不在这里卡：路由级 requirePermission 会让没补录权限的出纳连正常
// 付款都做不了，只有显式传 backfillRequest=true 时才在 service 侧条件校验。
const backfillFields = {
  backfillRequest: z.boolean().optional(),
  backfillReason: z.string().max(300).optional(),
}
router.post('/expense-claims/:id/pay',      requirePermission(PERMISSIONS.FINANCE_EXPENSE_PAY), vParams(idParam), validateBody(z.object({
  accountId: z.number().int().positive('请选择付款账户'),
  happenedAt: z.string().optional(),
  remark: z.string().max(300).optional().or(z.literal('')),
  ...backfillFields,
})), ctrl.expensePay)

module.exports = router
