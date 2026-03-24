const { Router } = require('express')
const { z }      = require('zod')
const ctrl       = require('./categories.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({
      success: false,
      message: r.error.errors.map(e => e.message).join('；'),
      data: null,
    })
    req.body = r.data
    next()
  }
}

const createSchema = z.object({
  name:      z.string().min(1, '名称不能为空').max(60),
  code:      z.string().max(50).optional().nullable(),
  parentId:  z.number().int().positive().optional().nullable(),
  sortOrder: z.number().int().optional(),
  remark:    z.string().max(500).optional().nullable(),
})

const updateSchema = z.object({
  name:      z.string().min(1, '名称不能为空').max(60),
  code:      z.string().max(50).optional().nullable(),
  sortOrder: z.number().int().optional(),
  status:    z.boolean().optional(),
  remark:    z.string().max(500).optional().nullable(),
})

// GET 接口
router.get('/tree',   ctrl.tree)
router.get('/flat',   ctrl.flat)
router.get('/leaves', ctrl.leaves)
router.get('/:id',    ctrl.detail)

// 写入接口
router.post('/',                   vBody(createSchema), ctrl.create)
router.put('/:id',                 vBody(updateSchema), ctrl.update)
router.delete('/:id',              ctrl.remove)
router.patch('/:id/status',        vBody(z.object({ status: z.boolean() })), ctrl.toggle)

module.exports = router
