const { Router } = require('express')
const { z } = require('zod')
const warehousesController = require('./warehouses.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const message = result.error.errors.map((e) => e.message).join('；')
      return res.status(400).json({ success: false, message, data: null })
    }
    req.body = result.data
    next()
  }
}

const createSchema = z.object({
  name:    z.string().min(1, '名称不能为空').max(100),
  type:    z.number().int().min(1).max(4),
  manager: z.string().max(50).optional(),
  phone:   z.string().max(20).optional(),
  address: z.string().max(200).optional(),
  remark:  z.string().max(500).optional(),
})

const updateSchema = createSchema.extend({
  isActive: z.boolean(),
})

router.use(authMiddleware)

router.get('/active',  warehousesController.listActive)
router.get('/',        warehousesController.list)
router.get('/:id',     warehousesController.detail)
router.post('/',       validateBody(createSchema), warehousesController.create)
router.put('/:id',     validateBody(updateSchema), warehousesController.update)
router.delete('/:id',  warehousesController.remove)

module.exports = router
