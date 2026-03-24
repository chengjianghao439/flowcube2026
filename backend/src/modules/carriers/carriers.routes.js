const { Router } = require('express')
const { z }      = require('zod')
const ctrl       = require('./carriers.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()

const vBody = schema => (req, res, next) => {
  const r = schema.safeParse(req.body)
  if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
  req.body = r.data; next()
}

const phoneRule = z.string().max(11).regex(/^1\d{10}$/, '请输入正确的手机号').optional().or(z.literal(''))

const createSchema = z.object({
  code:    z.string().min(1,'编码不能为空').max(30).optional(),
  name:    z.string().min(1,'名称不能为空').max(10,'承运商名称最多 10 个字符'),
  contact: z.string().max(5,'联系人最多 5 个字符').optional(),
  phone:   phoneRule,
  remark:  z.string().max(30,'备注最多 30 个字符').optional(),
})

const updateSchema = createSchema.extend({
  isActive: z.boolean(),
})

router.use(authMiddleware)

router.get('/active', ctrl.listActive)
router.get('/',        ctrl.list)
router.get('/:id',     ctrl.detail)
router.post('/',       vBody(createSchema), ctrl.create)
router.put('/:id',     vBody(updateSchema), ctrl.update)
router.delete('/:id',  ctrl.remove)

module.exports = router
