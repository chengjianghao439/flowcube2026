const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./products.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()
function vBody(schema) {
  return (req,res,next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success:false, message:r.error.errors.map(e=>e.message).join('；'), data:null })
    req.body = r.data; next()
  }
}

const catSchema = z.object({ name: z.string().min(1,'名称不能为空').max(60), sort: z.number().int().optional() })
const productBase = z.object({
  code:       z.string().min(1,'编码不能为空').max(50),
  name:       z.string().min(1,'名称不能为空').max(150),
  categoryId: z.number().int().positive().optional().nullable(),
  unit:       z.string().min(1).max(20).optional(),
  spec:       z.string().max(5,'商品规格最多 5 个字符').optional(),
  barcode:    z.string().max(60).optional(),
  costPrice:  z.number().nonnegative().optional().nullable(),
  salePrice:  z.number().nonnegative().optional().nullable(),
  remark:     z.string().max(30,'备注最多 30 个字符').optional(),
})

const generateCode = require('../../utils/generateCode')
const { successResponse } = require('../../utils/response')
router.use(authMiddleware)
router.get('/next-code', async (req, res, next) => {
  try {
    const code = await generateCode('product_items', 'code', 'code_prefix_product', 'PRD-')
    return successResponse(res, { code }, '生成成功')
  } catch (e) { next(e) }
})
router.get('/categories',      ctrl.catList)
router.post('/categories',     vBody(catSchema), ctrl.catCreate)
router.put('/categories/:id',  vBody(catSchema), ctrl.catUpdate)
router.delete('/categories/:id', ctrl.catDelete)

router.get('/finder', ctrl.finder)
router.get('/active', ctrl.listActive)
router.get('/',       ctrl.list)
router.post('/:id/print-label', ctrl.printLabel)
router.get('/:id',    ctrl.detail)
router.post('/',      vBody(productBase), ctrl.create)
router.put('/:id',    vBody(productBase.extend({ isActive: z.boolean() })), ctrl.update)
router.delete('/:id', ctrl.remove)

module.exports = router
