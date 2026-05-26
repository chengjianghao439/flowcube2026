const { Router } = require('express')
const ctrl = require('./settings.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
router.use(authMiddleware)
router.get('/', requirePermission(PERMISSIONS.SETTINGS_VIEW), ctrl.getAll)
router.put('/', requirePermission(PERMISSIONS.SETTINGS_UPDATE), ctrl.update)
module.exports = router
