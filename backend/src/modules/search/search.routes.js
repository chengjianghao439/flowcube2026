const { Router } = require('express')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const controller = require('./search.controller')
const { companyScope } = require('../../middleware/companyScope')

const router = Router()

router.use(authMiddleware)
router.use(companyScope)

router.get('/', requirePermission(PERMISSIONS.DASHBOARD_VIEW), controller.searchGlobal)

module.exports = router
