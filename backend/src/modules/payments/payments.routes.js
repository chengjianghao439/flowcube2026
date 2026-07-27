const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./payments.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
router.use(authMiddleware)

const vBody = s => (req,res,next) => { const r=s.safeParse(req.body); if(!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null}); req.body=r.data; next() }

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

router.get('/receipts',      requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.receiptList)
router.get('/receipts/:id',  requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), ctrl.receiptDetail)
router.post('/receipts',     requirePermission(PERMISSIONS.PAYMENT_EXECUTE), vBody(z.object({
  type: z.number().int().min(1).max(2),
  partyName: z.string().min(1, '往来方不能为空').max(100),
  amount: z.number().positive('汇款金额必须大于 0'),
  paymentDate: z.string().min(1, '请选择汇款日期'),
  method: z.string().max(50).optional(),
  // 新单必须指定资金账户，否则账户余额永远不准；历史单的 account_id 留空不回填
  accountId: z.number().int().positive('请选择收付款账户'),
  remark: z.string().max(300).optional(),
  allocations: allocationRule,
})), ctrl.receiptCreate)
router.post('/receipts/:id/settle', requirePermission(PERMISSIONS.PAYMENT_EXECUTE), vParams(idParam), vBody(z.object({
  allocations: allocationRule,
})), ctrl.receiptSettle)

// ── 汇总对账单（月结）────────────────────────────────────────────────────────
router.get('/statements',            requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.statementList)
router.get('/statements/candidates', requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.statementCandidates)
router.get('/statements/:id',        requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), ctrl.statementDetail)
router.post('/statements',           requirePermission(PERMISSIONS.PAYMENT_EXECUTE), vBody(z.object({
  type: z.number().int().min(1).max(2),
  partyName: z.string().min(1, '往来方不能为空').max(100),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  recordIds: z.array(z.number().int().positive()).min(1, '请至少选择一笔账款'),
  remark: z.string().max(300).optional(),
})), ctrl.statementCreate)
router.post('/statements/:id/confirm', requirePermission(PERMISSIONS.PAYMENT_CONFIRM), vParams(idParam), ctrl.statementConfirm)
router.post('/statements/:id/unlock',  requirePermission(PERMISSIONS.PAYMENT_CONFIRM), vParams(idParam), ctrl.statementUnlock)
router.delete('/statements/:id/items/:recordId', requirePermission(PERMISSIONS.PAYMENT_EXECUTE), ctrl.statementRemoveItem)

// 列表（含合计）
router.get('/', requirePermission(PERMISSIONS.PAYMENT_VIEW), ctrl.list)

// 手动创建账款（也可从采购/销售单自动创建）
router.post('/', requirePermission(PERMISSIONS.PAYMENT_CREATE), vBody(z.object({ type:z.number().int().min(1).max(2), orderNo:z.string(), partyName:z.string(), totalAmount:z.number().positive(), dueDate:z.string().optional(), remark:z.string().optional() })), ctrl.create)

// 登记付款/收款
router.post('/:id/pay', requirePermission(PERMISSIONS.PAYMENT_EXECUTE), vParams(idParam), vBody(z.object({ amount:z.number().positive('金额必须大于0'), paymentDate:z.string(), method:z.string().optional(), remark:z.string().optional() })), ctrl.pay)

// 账款明细（付款记录）
router.get('/:id/entries', requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), ctrl.entries)

// 应付结算财务确认（确认后才允许登记付款；金额重算改变会自动打回待确认）
router.post('/:id/confirm', requirePermission(PERMISSIONS.PAYMENT_CONFIRM), vParams(idParam), ctrl.confirm)

// 应付结算明细对照（确认页展示：实际上架量×采购单价 + 退货冲减）
router.get('/:id/settlement-detail', requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), ctrl.settlementDetail)

module.exports = router
