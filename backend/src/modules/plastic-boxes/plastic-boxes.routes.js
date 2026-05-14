const { Router } = require('express')
const ctrl = require('./plastic-boxes.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

router.get('/',            requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.list)
router.post('/',           requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT), ctrl.create)
router.get('/:id',         requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.detail)
router.get('/:id/movements', requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.movements)
router.delete('/:id',      requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT), ctrl.remove)

module.exports = router
