const { Router } = require('express')
const ctrl = require('./print-jobs.controller')
const { authMiddleware } = require('../../middleware/auth')
const router = Router()

// SSE 监听端点（打印客户端使用，无需 JWT — 通过 printerCode 鉴权）
router.get('/listen/:printerCode', ctrl.listen)

// 以下需要登录
router.use(authMiddleware)
router.get('/',                ctrl.list)
router.get('/:id',             ctrl.detail)
router.post('/',               ctrl.create)
router.post('/:id/complete',   ctrl.complete)
router.post('/:id/fail',       ctrl.fail)
router.post('/:id/retry',      ctrl.retry)

module.exports = router
