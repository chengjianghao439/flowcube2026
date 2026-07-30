const { Router } = require('express')
const ctrl = require('./serials.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

// 固定路径先注册（本模块暂无 /:id 动态路由，但保持约定：固定段在前）
router.get('/trace', requirePermission(PERMISSIONS.SERIAL_VIEW), ctrl.trace)
router.get('/check-consistency', requirePermission(PERMISSIONS.SERIAL_MANAGE), ctrl.checkConsistency)
router.get('/', requirePermission(PERMISSIONS.SERIAL_VIEW), ctrl.list)

module.exports = router
