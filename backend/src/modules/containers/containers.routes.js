const { Router } = require('express')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const ctrl = require('./containers.controller')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)
router.get('/overdue', requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.overdue)

module.exports = router
