const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./products.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
function vBody(schema) {
  return (req,res,next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success:false, message:r.error.errors.map(e=>e.message).join('；'), data:null })
    req.body = r.data; next()
  }
}

const productBase = z.object({
  code:       z.string().min(1,'编码不能为空').max(50).optional(),
  name:       z.string().min(1,'名称不能为空').max(150),
  categoryId: z.number().int().positive('请选择商品分类'),
  unit:       z.string().min(1).max(20).optional(),
  spec:       z.string().max(5,'商品规格最多 5 个字符').optional(),
  barcode:    z.string().min(1,'产品条码不能为空').max(60),
  costPrice:  z.number().positive('进价必须大于 0'),
  remark:     z.string().max(30,'备注最多 30 个字符').optional(),
})

const generateCode = require('../../utils/generateCode')
const { successResponse } = require('../../utils/response')
router.use(authMiddleware)
router.get('/next-code', async (req, res, next) => {
  try {
    const code = await generateCode('product_items', 'code', 'code_prefix_product', 'P')
    return successResponse(res, { code }, '生成成功')
  } catch (e) { next(e) }
})
router.get('/finder', requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.finder)
router.get('/active', requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.listActive)
router.get('/',       requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.list)
router.post('/:id/print-label', requirePermission(PERMISSIONS.PRODUCT_PRINT_LABEL), ctrl.printLabel)
router.get('/:id',    requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.detail)
router.post('/',      requirePermission(PERMISSIONS.PRODUCT_CREATE), vBody(productBase), ctrl.create)
router.put('/:id',    requirePermission(PERMISSIONS.PRODUCT_UPDATE), vBody(productBase.extend({ isActive: z.boolean() })), ctrl.update)
router.delete('/:id', requirePermission(PERMISSIONS.PRODUCT_DELETE), ctrl.remove)

module.exports = router
