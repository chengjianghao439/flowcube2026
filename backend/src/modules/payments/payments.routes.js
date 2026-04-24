const { Router } = require('express')
const { z } = require('zod')
const { successResponse } = require('../../utils/response')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { getOperatorFromRequest } = require('../../utils/operator')
const svc = require('./payments.service')
const router = Router()
router.use(authMiddleware)

const vBody = s => (req,res,next) => { const r=s.safeParse(req.body); if(!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null}); req.body=r.data; next() }

const vParams = s => (req,res,next) => {
  const r = s.safeParse(req.params)
  if (!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null})
  req.params = r.data; next()
}
const idParam = z.object({ id: z.coerce.number().int().positive('id 必须为正整数') })

// 列表（含合计）
router.get('/', requirePermission(PERMISSIONS.PAYMENT_VIEW), async (req, res, next) => {
  try {
    return successResponse(res, await svc.findAll(req.query), '查询成功')
  } catch (e) { next(e) }
})

// 手动创建账款（也可从采购/销售单自动创建）
router.post('/', requirePermission(PERMISSIONS.PAYMENT_CREATE), vBody(z.object({ type:z.number().int().min(1).max(2), orderNo:z.string(), partyName:z.string(), totalAmount:z.number().positive(), dueDate:z.string().optional(), remark:z.string().optional() })), async (req,res,next) => {
  try {
    const operator = getOperatorFromRequest(req)
    return successResponse(res, await svc.createManual(req.body, operator), '创建成功', 201)
  } catch (e) { next(e) }
})

// 登记付款/收款
router.post('/:id/pay', requirePermission(PERMISSIONS.PAYMENT_EXECUTE), vParams(idParam), vBody(z.object({ amount:z.number().positive('金额必须大于0'), paymentDate:z.string(), method:z.string().optional(), remark:z.string().optional() })), async (req,res,next) => {
  try {
    const id = +req.params.id
    const operator = getOperatorFromRequest(req)
    return successResponse(res, await svc.recordPayment(id, req.body, operator), '登记成功')
  } catch (e) { next(e) }
})

// 账款明细（付款记录）
router.get('/:id/entries', requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), async (req,res,next) => {
  try {
    return successResponse(res, await svc.findEntries(+req.params.id), '查询成功')
  } catch (e) { next(e) }
})

module.exports = router
