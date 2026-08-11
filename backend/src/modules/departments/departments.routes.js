const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./departments.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const departmentSchema = z.object({
  name: z.string().min(1, '部门名称不能为空').max(50),
  parentId: z.number().int().nonnegative().optional(),
  managerId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  remark: z.string().max(200).optional(),
})
const updateSchema = z.object({
  name: z.string().min(1, '部门名称不能为空').max(50).optional(),
  parentId: z.number().int().nonnegative().optional(),
  managerId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  remark: z.string().max(200).nullable().optional(),
})

router.use(authMiddleware)
router.get('/',         requirePermission(PERMISSIONS.DEPARTMENT_VIEW),   ctrl.list)
router.get('/options',  ctrl.options)
router.post('/',        requirePermission(PERMISSIONS.DEPARTMENT_CREATE), validateBody(departmentSchema), ctrl.create)
router.put('/:id',      requirePermission(PERMISSIONS.DEPARTMENT_UPDATE), validateBody(updateSchema),      ctrl.update)
router.delete('/:id',   requirePermission(PERMISSIONS.DEPARTMENT_DELETE), ctrl.remove)

module.exports = router
