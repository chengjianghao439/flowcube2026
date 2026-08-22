const { Router } = require('express')
const ctrl = require('./oplogs.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const AppError = require('../../utils/AppError')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
router.use(authMiddleware)

router.get('/', requirePermission(PERMISSIONS.AUDIT_LOG_VIEW), ctrl.list)

// 清理审计日志（2026-08-22 加固）：审计日志是唯一防抵赖记录，仅超管可清
router.delete('/clear',
  requirePermission(PERMISSIONS.AUDIT_LOG_CLEAR),
  (req, res, next) => {
    if (Number(req.user?.roleId) !== 1) {
      return next(new AppError('仅管理员可清理审计日志', 403, 'AUDIT_LOG_CLEAR_ADMIN_ONLY'))
    }
    return next()
  },
  ctrl.clear)

module.exports = router
