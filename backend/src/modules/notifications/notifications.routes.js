const { Router } = require('express')
const ctrl = require('./notifications.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

router.get('/', requirePermission(PERMISSIONS.DASHBOARD_VIEW), ctrl.list)

module.exports = router
