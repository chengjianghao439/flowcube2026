const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./suppliers.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()
function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success:false, message: r.error.errors.map(e=>e.message).join('；'), data:null })
    req.body = r.data; next()
  }
}

const phoneRule = z.string().max(11).regex(/^1\d{10}$/, '请输入正确的手机号').optional().or(z.literal(''))
const base = z.object({
  code:    z.string().min(1,'编码不能为空').max(30),
  name:    z.string().min(1,'名称不能为空').max(20,'供应商名称最多 20 个字符'),
  contact: z.string().max(5,'联系人最多 5 个字符').optional(),
  phone:   phoneRule,
  email:   z.string().email('邮箱格式不正确').max(100).optional().or(z.literal('')),
  address: z.string().max(30,'地址最多 30 个字符').optional(),
  remark:  z.string().max(30,'备注最多 30 个字符').optional(),
})

const generateCode = require('../../utils/generateCode')
const { successResponse } = require('../../utils/response')
router.use(authMiddleware)
router.get('/next-code', async (req, res, next) => {
  try {
    const code = await generateCode('supply_suppliers', 'code', 'code_prefix_supplier', 'SUP-')
    return successResponse(res, { code }, '生成成功')
  } catch (e) { next(e) }
})
router.get('/active', ctrl.listActive)
router.get('/',       ctrl.list)
router.get('/:id',    ctrl.detail)
router.post('/',      vBody(base), ctrl.create)
router.put('/:id',    vBody(base.extend({ isActive: z.boolean() })), ctrl.update)
router.delete('/:id', ctrl.remove)

module.exports = router
