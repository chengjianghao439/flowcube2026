const { Router } = require('express')
const { z } = require('zod')
const { pool } = require('../../config/db')
const { successResponse } = require('../../utils/response')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const AppError = require('../../utils/AppError')
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

// 列表（含合计）
router.get('/', requirePermission(PERMISSIONS.PAYMENT_VIEW), async (req, res, next) => {
  try {
    const { page=1, pageSize=20, type='', status='' } = req.query
    const offset = (+page-1)*+pageSize
    const conds = []; const params = []
    if (type) { conds.push('type=?'); params.push(+type) }
    if (status) { conds.push('status=?'); params.push(+status) }
    const w = conds.length ? 'WHERE '+conds.join(' AND ') : ''
    const [rows] = await pool.query(`SELECT * FROM payment_records ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`,[...params,+pageSize,offset])
    const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM payment_records ${w}`,params)
    const [[summary]] = await pool.query(`SELECT COALESCE(SUM(total_amount),0) AS totalAmount, COALESCE(SUM(paid_amount),0) AS paidAmount, COALESCE(SUM(balance),0) AS balance FROM payment_records ${w}`,params)
    const list = rows.map(r => ({ id:r.id, type:r.type, typeName:r.type===1?'应付':'应收', orderNo:r.order_no, partyName:r.party_name, totalAmount:Number(r.total_amount), paidAmount:Number(r.paid_amount), balance:Number(r.balance), status:r.status, statusName:{1:'未付',2:'部分付',3:'已付清'}[r.status], dueDate:r.due_date, remark:r.remark, createdAt:r.created_at }))
    return successResponse(res, { list, pagination:{page:+page,pageSize:+pageSize,total}, summary:{ totalAmount:Number(summary.totalAmount), paidAmount:Number(summary.paidAmount), balance:Number(summary.balance) } }, '查询成功')
  } catch (e) { next(e) }
})

// 手动创建账款（也可从采购/销售单自动创建）
router.post('/', requirePermission(PERMISSIONS.PAYMENT_CREATE), vBody(z.object({ type:z.number().int().min(1).max(2), orderNo:z.string(), partyName:z.string(), totalAmount:z.number().positive(), dueDate:z.string().optional(), remark:z.string().optional() })), async (req,res,next) => {
  try {
    const { type, orderNo, partyName, totalAmount, dueDate, remark } = req.body
    const [r] = await pool.query(`INSERT INTO payment_records (type,order_no,party_name,total_amount,balance,due_date,remark) VALUES (?,?,?,?,?,?,?)`,[type,orderNo,partyName,totalAmount,totalAmount,dueDate||null,remark||null])
    return successResponse(res, { id:r.insertId }, '创建成功', 201)
  } catch (e) { next(e) }
})

// 登记付款/收款
router.post('/:id/pay', requirePermission(PERMISSIONS.PAYMENT_EXECUTE), vParams(idParam), vBody(z.object({ amount:z.number().positive('金额必须大于0'), paymentDate:z.string(), method:z.string().optional(), remark:z.string().optional() })), async (req,res,next) => {
  try {
    const id = +req.params.id
    const [[record]] = await pool.query('SELECT * FROM payment_records WHERE id=?',[id])
    if (!record) throw new AppError('账款记录不存在',404)
    if (record.status===3) throw new AppError('该账款已付清',400)
    const newPaid = Number(record.paid_amount) + req.body.amount
    if (newPaid > Number(record.total_amount)) throw new AppError(`付款金额超出余额 ¥${Number(record.balance).toFixed(2)}`,400)
    const newBalance = Number(record.total_amount) - newPaid
    const newStatus = newBalance <= 0 ? 3 : 2
    await pool.query('UPDATE payment_records SET paid_amount=?,balance=?,status=? WHERE id=?',[newPaid,newBalance,newStatus,id])
    const [[u]] = await pool.query('SELECT real_name FROM sys_users WHERE id=?',[req.user.userId])
    await pool.query(`INSERT INTO payment_entries (record_id,amount,payment_date,method,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?)`,[id,req.body.amount,req.body.paymentDate,req.body.method||null,req.body.remark||null,req.user.userId,u?.real_name||'未知'])
    return successResponse(res, { newPaid, newBalance, status:newStatus }, '登记成功')
  } catch (e) { next(e) }
})

// 账款明细（付款记录）
router.get('/:id/entries', requirePermission(PERMISSIONS.PAYMENT_VIEW), vParams(idParam), async (req,res,next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM payment_entries WHERE record_id=? ORDER BY created_at ASC',[+req.params.id])
    return successResponse(res, rows.map(r=>({ id:r.id, amount:Number(r.amount), paymentDate:r.payment_date, method:r.method, remark:r.remark, operatorName:r.operator_name, createdAt:r.created_at })), '查询成功')
  } catch (e) { next(e) }
})

module.exports = router
