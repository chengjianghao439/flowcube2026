const { Router } = require('express')
const ctrl = require('./oplogs.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
router.use(authMiddleware)

router.get('/', requirePermission(PERMISSIONS.AUDIT_LOG_VIEW), ctrl.list)

router.delete('/clear', requirePermission(PERMISSIONS.AUDIT_LOG_CLEAR), ctrl.clear)

module.exports = router
