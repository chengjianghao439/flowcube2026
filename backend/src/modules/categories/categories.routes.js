const { Router } = require('express')
const { z }      = require('zod')
const ctrl       = require('./categories.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()
router.use(authMiddleware)

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
router.get('/tree',   requirePermission(PERMISSIONS.CATEGORY_VIEW), ctrl.tree)
router.get('/flat',   requirePermission(PERMISSIONS.CATEGORY_VIEW), ctrl.flat)
router.get('/leaves', requirePermission(PERMISSIONS.CATEGORY_VIEW), ctrl.leaves)
router.get('/:id',    requirePermission(PERMISSIONS.CATEGORY_VIEW), ctrl.detail)

// 写入接口
router.post('/',                   requirePermission(PERMISSIONS.CATEGORY_CREATE), validateBody(createSchema), ctrl.create)
router.put('/:id',                 requirePermission(PERMISSIONS.CATEGORY_UPDATE), validateBody(updateSchema), ctrl.update)
router.delete('/:id',              requirePermission(PERMISSIONS.CATEGORY_DELETE), ctrl.remove)
router.patch('/:id/status',        requirePermission(PERMISSIONS.CATEGORY_UPDATE), validateBody(z.object({ status: z.boolean() })), ctrl.toggle)

module.exports = router
