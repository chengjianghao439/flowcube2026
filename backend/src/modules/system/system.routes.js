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
        message: r.error.issues.map(e => e.message).join('；'),
        data: null,
      })
    }
    req.query = r.data
    next()
  }
}

const requestStatusQuery = z.object({
  // 缺失字段继续沿原中文提示，其他类型错误沿校验器默认提示。
  action: z.string({ error: issue => issue.input === undefined ? '缺少 action 参数' : undefined }).trim().min(1, '缺少 action 参数'),
  // 新建尚无资源ID：保留原仓与正文指纹供领域闸门核对；其他回执仍可省略。
  warehouseId: z.coerce.number().int().positive().optional(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})

router.use(authMiddleware)

// GET /api/system/request-status/:key — 查询关键操作的提交回执（断网后确认「上次到底成没成」）
// 不挂 requirePermission：查的是调用者自己的提交结果，且底层按 user_id 限定；
// 若要求业务权限，反而会让权限被调整过的操作员无法确认自己刚才那次操作。
router.get('/request-status/:key', vQuery(requestStatusQuery), require('./system.split-device').splitReceiptDevice, ctrl.requestStatus)
// POST /api/system/error-report — 前端 GlobalErrorBoundary 上报渲染错误（进 Loki 检索）
router.post('/error-report', ctrl.reportError)

module.exports = router
