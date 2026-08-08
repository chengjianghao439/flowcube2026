const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./dashboard.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')
const router = Router()
router.use(authMiddleware)

// 布局只做结构浅校验：id/显隐/宽度合法即可，具体 widget 语义由前端注册表负责。
// 数组上限 80 兜底防垃圾写入（注册表实际远小于此）。
const layoutSchema = z.object({
  widgets: z.array(z.object({
    id:      z.string().min(1).max(64),
    visible: z.boolean(),
    w:       z.number().int().min(1).max(4),
  })).max(80),
})

router.get('/summary',    requirePermission(PERMISSIONS.DASHBOARD_VIEW), ctrl.summary)
router.get('/low-stock',  requirePermission(PERMISSIONS.DASHBOARD_VIEW), ctrl.lowStock)
router.get('/trend',      requirePermission(PERMISSIONS.DASHBOARD_VIEW), ctrl.trend)
router.get('/top-stock',  requirePermission(PERMISSIONS.DASHBOARD_VIEW), ctrl.topStock)
router.get('/incoming-purchases', requirePermission(PERMISSIONS.DASHBOARD_VIEW), ctrl.incomingPurchases)
router.get('/layout',     requirePermission(PERMISSIONS.DASHBOARD_VIEW), ctrl.layout)
router.put('/layout',     requirePermission(PERMISSIONS.DASHBOARD_VIEW), validateBody(layoutSchema), ctrl.saveLayout)
module.exports = router
