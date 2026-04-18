const { Router } = require('express')
const ctrl = require('./print-templates.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

router.get('/',           requirePermission(PERMISSIONS.PRINT_TEMPLATE_VIEW), ctrl.list)
router.get('/:id',        requirePermission(PERMISSIONS.PRINT_TEMPLATE_VIEW), ctrl.detail)
router.post('/',          requirePermission(PERMISSIONS.PRINT_TEMPLATE_MANAGE), ctrl.create)
router.put('/:id',        requirePermission(PERMISSIONS.PRINT_TEMPLATE_MANAGE), ctrl.update)
router.post('/:id/default', requirePermission(PERMISSIONS.PRINT_TEMPLATE_MANAGE), ctrl.setDefault)
router.delete('/:id',     requirePermission(PERMISSIONS.PRINT_TEMPLATE_MANAGE), ctrl.remove)

module.exports = router
