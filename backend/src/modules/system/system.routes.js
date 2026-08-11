const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./system.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()

function vQuery(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.query)
    if (!r.success) {
      return res.status(400).json({
        success: false,
        message: r.error.errors.map(e => e.message).join('；'),
        data: null,
      })
    }
    req.query = r.data
    next()
  }
}

const requestStatusQuery = z.object({
  // required_error 不能省：字段整个缺失时触发的是 required 而非 min，
  // 只写 min 的话用户拿到的是 zod 默认的英文 "Required"
  action: z.string({ required_error: '缺少 action 参数' }).trim().min(1, '缺少 action 参数'),
})

router.use(authMiddleware)

// GET /api/system/request-status/:key — 查询关键操作的提交回执（断网后确认「上次到底成没成」）
// 不挂 requirePermission：查的是调用者自己的提交结果，且底层按 user_id 限定；
// 若要求业务权限，反而会让权限被调整过的操作员无法确认自己刚才那次操作。
router.get('/request-status/:key', vQuery(requestStatusQuery), ctrl.requestStatus)
// POST /api/system/error-report — 前端 GlobalErrorBoundary 上报渲染错误（进 Loki 检索）
router.post('/error-report', ctrl.reportError)

module.exports = router
