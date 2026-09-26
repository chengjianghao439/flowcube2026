const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./payments.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')
const router = Router()
router.use(authMiddleware)

const vParams = s => (req,res,next) => {
  const r = s.safeParse(req.params)
  if (!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null})
  req.params = r.data; next()
}
const idParam = z.object({ id: z.coerce.number().int().positive('id 必须为正整数') })

// ── 收付款单与核销 ──────────────────────────────────────────────────────────
// 注意：必须注册在 '/:id' 之类的动态路由之前，否则 /receipts 会被当成 id 吃掉。
// 核销目标二选一：recordId（直接核账款，现结）或 statementId（核对账单，月结）
const allocationRule = z.array(z.object({
  recordId: z.number().int().positive().optional(),
  statementId: z.number().int().positive().optional(),
  amount: z.number().positive('核销金额必须大于 0'),
}).refine(a => !!a.recordId !== !!a.statementId, '核销目标必须且只能指定账款或对账单其中之一')).default([])

// 跨期补录（2026-09-26 一致性审查 · 任务 7）：显式请求把业务登记进已结账的会计期间。
// 走的是**先审批、后动账**：本次提交只落一张待审批申请单（响应 202），批准是**他人**的操作，
// 执行时才真正写业务数据、并把调整凭证做在补录当期。
// 必须在 schema 里声明——validateBody 用 schema.parse 的结果**整体替换** req.body，
// 未声明的字段会被 zod 剥掉，controller 读到的 req.body.backfillRequest 恒为 undefined，
// 申请入口形同虚设。
// 权限不在这里用 requirePermission 卡：那是路由级的，会让没补录权限的出纳连正常付款都做不了；
// 只有显式传 backfillRequest=true 时才在 service 侧条件校验 finance.period.backfill
// （见 resolveBackfillRequest）。
const backfillFields = {
  backfillRequest: z.boolean().optional(),
  backfillReason: z.string().max(300).optional(),
}

router.get('/receipts',      requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.receiptList)
router.get('/receipts/:id',  requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), ctrl.receiptDetail)
router.post('/receipts',     requirePermission(PERMISSIONS.PAYMENT_EXECUTE), validateBody(z.object({
  type: z.number().int().min(1).max(2),
  partyName: z.string().min(1, '往来方不能为空').max(100),
  partyId: z.number().int().positive().optional(),
  amount: z.number().positive('汇款金额必须大于 0'),
  paymentDate: z.string().min(1, '请选择汇款日期'),
  method: z.string().max(50).optional(),
  // 新单必须指定资金账户，否则账户余额永远不准；历史单的 account_id 留空不回填
  accountId: z.number().int().positive('请选择收付款账户'),
  remark: z.string().max(300).optional(),
  allocations: allocationRule,
  ...backfillFields,
})), ctrl.receiptCreate)
router.post('/receipts/:id/settle', requirePermission(PERMISSIONS.PAYMENT_EXECUTE), vParams(idParam), validateBody(z.object({
  allocations: allocationRule,
  ...backfillFields,
})), ctrl.receiptSettle)

// ── 汇总对账单（月结）────────────────────────────────────────────────────────
router.get('/statements',            requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.statementList)
router.get('/statements/candidates', requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.statementCandidates)
router.get('/statements/:id',        requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), ctrl.statementDetail)
router.post('/statements',           requirePermission(PERMISSIONS.PAYMENT_EXECUTE), validateBody(z.object({
  type: z.number().int().min(1).max(2),
  partyName: z.string().min(1, '往来方不能为空').max(100),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  recordIds: z.array(z.number().int().positive()).min(1, '请至少选择一笔账款'),
  remark: z.string().max(300).optional(),
})), ctrl.statementCreate)
router.post('/statements/:id/confirm', requirePermission(PERMISSIONS.PAYMENT_CONFIRM), vParams(idParam), ctrl.statementConfirm)
router.post('/statements/:id/unlock',  requirePermission(PERMISSIONS.PAYMENT_CONFIRM), vParams(idParam), ctrl.statementUnlock)
router.delete('/statements/:id/items/:recordId', requirePermission(PERMISSIONS.PAYMENT_EXECUTE),
  vParams(z.object({ id: z.coerce.number().int().positive(), recordId: z.coerce.number().int().positive() })), ctrl.statementRemoveItem)

// 账龄分析（as-of 今天，应收/应付分桶敞口 + Top 往来方）。静态路径，注册在 '/:id/...' 动态路由之前
router.get('/party-ledger', requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.ledger)

router.get('/aging', requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.aging)

// 手工应付可选的借方科目（任务 3b）。静态单段路径，注册在 '/:id/...' 动态路由之前；
// 权限与手工建账款一致（能建账款的才能看到可选科目，否则财务先建后改没地方改）。
router.get('/debit-account-options', requirePermission(PERMISSIONS.PAYMENT_CREATE), ctrl.debitAccountOptions)

// 列表（含合计）
router.get('/', requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.list)

// 手动创建账款（也可从采购/销售单自动创建）
// debitAccountCode 只对 type=1（应付）有效：必须在此声明，否则 validateBody 会把它剥掉，
// service 侧读到的恒为 undefined，「手工应付必须选择借方科目」直接变成永远报错。
// settlementType 决定这笔账款落在「现结账款页」还是「月结对账页」（两页按 settlement_type 筛），
// 前端必选；不声明同样会被剥掉，新建的手工应付就会一律掉进建表默认的月结范围。
router.post('/', requirePermission(PERMISSIONS.PAYMENT_CREATE), validateBody(z.object({
  type: z.number().int().min(1).max(2),
  orderNo: z.string().min(1, '单号不能为空').max(50),
  partyName: z.string().min(1, '往来方不能为空').max(100),
  totalAmount: z.number().positive('金额必须大于 0'),
  settlementType: z.number().int().min(1).max(2).optional(),
  dueDate: z.string().optional(),
  remark: z.string().max(300).optional(),
  debitAccountCode: z.string().min(1).max(20).optional(),
})), ctrl.create)

// 登记付款/收款
router.post('/:id/pay', requirePermission(PERMISSIONS.PAYMENT_EXECUTE), vParams(idParam), validateBody(z.object({ amount:z.number().positive('金额必须大于0'), paymentDate:z.string(), method:z.string().optional(), accountId:z.coerce.number().int().positive().optional(), remark:z.string().optional(), ...backfillFields })), ctrl.pay)

// 账款明细（付款记录）
router.get('/:id/entries', requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), ctrl.entries)

// 应付结算财务确认（确认后才允许登记付款；金额重算改变会自动打回待确认）
router.post('/:id/confirm', requirePermission(PERMISSIONS.PAYMENT_CONFIRM), vParams(idParam), ctrl.confirm)

// 应付结算明细对照（确认页展示：实际上架量×采购单价 + 退货冲减）
router.get('/:id/settlement-detail', requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), ctrl.settlementDetail)

module.exports = router
