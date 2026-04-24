const { Router } = require('express')
const { successResponse } = require('../../utils/response')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const svc = require('./notifications.service')

const router = Router()
router.use(authMiddleware)

router.get('/', requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (req, res, next) => {
  try {
    return successResponse(res, await svc.buildNotifications(), '查询成功')
  } catch (e) { next(e) }
})

module.exports = router
