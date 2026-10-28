const { Router, json } = require('express')
const { authMiddleware, requireAnyPermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBodyBudget } = require('../../middleware/apiIngress')
const AppError = require('../../utils/AppError')
const ctrl = require('./assistant.controller')

const router = Router()
const entryPermissions = [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.REPORT_VIEW]
router.use(authMiddleware)
router.use(requireAnyPermission(entryPermissions))
// 此模块在全局大正文解析前挂载：先当前身份/权限，再有界 JSON；不自建 CORS 或限流。
router.use((req, _res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    if (Number(req.headers['content-length']) > 32768) return next(new AppError('输入内容过长，请缩短后重试', 413, 'PAYLOAD_TOO_LARGE'))
    const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']
    if (hasBody && !req.is('application/json')) return next(new AppError('请求内容须为 JSON', 415, 'UNSUPPORTED_MEDIA_TYPE'))
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') return next(new AppError('不接受压缩请求正文', 415, 'UNSUPPORTED_CONTENT_ENCODING'))
  }
  next()
})
router.use(json({ limit: 32768, strict: true, inflate: false }))
router.use(validateBodyBudget)

router.get('/health', ctrl.health)
router.get('/me', ctrl.me)
router.get('/tools', ctrl.tools)
router.get('/tasks', ctrl.list)
router.get('/tasks/:id', ctrl.detail)
router.post('/chat', requireAnyPermission(entryPermissions), ctrl.chat)
router.post('/tasks/:id/confirm', requireAnyPermission(entryPermissions), ctrl.confirm)
router.post('/tasks/:id/cancel', requireAnyPermission(entryPermissions), ctrl.cancel)
router.use((_req, _res, next) => next(new AppError('接口不存在', 404, 'NOT_FOUND')))

module.exports = router
