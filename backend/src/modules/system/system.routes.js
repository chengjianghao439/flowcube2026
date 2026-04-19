const router = require('express').Router()
const { authMiddleware: auth } = require('../../middleware/auth')
const { runAllChecks, getRecentLogs, getRunSummaries } = require('./healthCheck.service')
const { runAutoFix, AUTO_FIXABLE_CHECK_TYPES } = require('./healthCheck.autoFix')
const { getOperationRequestStatus } = require('../../utils/operationRequest')

/**
 * GET /api/system/health
 * 立即执行一次全量巡检并返回本次结果
 * 同时将发现的问题持久化到 system_health_logs
 * 权限：需要登录（管理员角色建议在前端控制）
 */
router.get('/health', auth, async (req, res, next) => {
  try {
    const result = await runAllChecks()
    res.json({ success: true, message: '巡检完成', data: result })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/system/health/logs?limit=100
 * 查询历史巡检日志明细（按 created_at 降序）
 */
router.get('/health/logs', auth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const logs  = await getRecentLogs(limit)
    res.json({ success: true, message: 'ok', data: logs })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/system/health/runs?limit=20
 * 查询历史巡检摘要（按 run_id 聚合，每次巡检一行）
 */
router.get('/health/runs', auth, async (req, res, next) => {
  try {
    const limit    = Math.min(Number(req.query.limit) || 20, 100)
    const summaries = await getRunSummaries(limit)
    res.json({ success: true, message: 'ok', data: summaries })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/system/health/autofix
 * 执行可自动修复的仓库流程异常（孤立资源释放）
 * 权限：需要登录
 */
router.post('/health/autofix', auth, async (req, res, next) => {
  try {
    const result = await runAutoFix('manual')
    const msg = result.fixedCount > 0
      ? `自动修复完成，共修复 ${result.fixedCount} 项异常`
      : '巡检完成，未发现可自动修复的异常'
    res.json({ success: true, message: msg, data: result })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/system/health/autofix/types
 * 查询当前支持自动修复的异常类型列表
 */
router.get('/health/autofix/types', auth, async (req, res) => {
  res.json({ success: true, message: 'ok', data: AUTO_FIXABLE_CHECK_TYPES })
})

router.get('/request-status/:requestKey', auth, async (req, res, next) => {
  try {
    const action = String(req.query.action || '').trim()
    if (!action) {
      return res.status(400).json({ success: false, message: '缺少 action', data: null })
    }
    const result = await getOperationRequestStatus({
      requestKey: req.params.requestKey,
      action,
      userId: req.user?.userId ?? null,
    })
    return res.json({ success: true, message: result.message, data: result })
  } catch (err) {
    next(err)
  }
})

module.exports = router
