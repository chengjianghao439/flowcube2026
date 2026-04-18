const { Router } = require('express')
const svc = require('./settings.service')
const { successResponse } = require('../../utils/response')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
router.use(authMiddleware)
router.get('/', requirePermission(PERMISSIONS.SETTINGS_VIEW), async (req, res, next) => {
  try { return successResponse(res, await svc.getAll(), '查询成功') } catch (e) { next(e) }
})
router.put('/', requirePermission(PERMISSIONS.SETTINGS_UPDATE), async (req, res, next) => {
  try {
    await svc.updateMany(req.body)
    return successResponse(res, null, '保存成功')
  } catch (e) { next(e) }
})
module.exports = router
