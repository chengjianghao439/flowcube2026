const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./customer-addresses.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const vQuery = schema => (req, res, next) => {
  const r = schema.safeParse(req.query)
  if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
  req.query = r.data
  next()
}

// 字段口径与销售单收货字段对齐：兼容部门名、座机与国际号码，保留合理长度上限。
const phoneRule = z.string().max(30).regex(/^[0-9+()\-\s]*$/, '请输入正确的联系电话').optional().or(z.literal(''))
const writable = z.object({
  receiverName: z.string().max(30, '收货人最多 30 个字符').optional().or(z.literal('')),
  receiverPhone: phoneRule,
  receiverAddress: z.string().min(1, '收货地址不能为空').max(200, '收货地址最多 200 个字符'),
  isDefault: z.boolean().optional(),
})
const createBody = writable.extend({ customerId: z.coerce.number().int().positive('客户不合法') })
const listQuery = z.object({ customerId: z.coerce.number().int().positive('客户不合法') })

router.use(authMiddleware)

router.get('/',            requirePermission(PERMISSIONS.CUSTOMER_VIEW),   vQuery(listQuery),  ctrl.list)
router.post('/',           requirePermission(PERMISSIONS.CUSTOMER_UPDATE), validateBody(createBody),  ctrl.create)
router.put('/:id',         requirePermission(PERMISSIONS.CUSTOMER_UPDATE), validateBody(writable),    ctrl.update)
router.put('/:id/default', requirePermission(PERMISSIONS.CUSTOMER_UPDATE),                     ctrl.setDefault)
router.delete('/:id',      requirePermission(PERMISSIONS.CUSTOMER_UPDATE),                     ctrl.remove)

module.exports = router
