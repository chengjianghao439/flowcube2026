const router = require('express').Router()
const { z } = require('zod')
const { authMiddleware: auth, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { runAllChecks, getRecentLogs, getRunSummaries } = require('./healthCheck.service')
const { runAutoFix, AUTO_FIXABLE_CHECK_TYPES } = require('./healthCheck.autoFix')
const { getOperationRequestStatus } = require('../../utils/operationRequest')
const AppError = require('../../utils/AppError')
const { successRoute, validateQuery, validateParams } = require('../../utils/route')

const limitQuery = (fallback, max) => z.object({
  limit: z.coerce.number().int().positive().max(max).optional().default(fallback),
}).passthrough()

const requestStatusParams = z.object({
  requestKey: z.string().trim().min(1, 'requestKey 不能为空'),
})

const requestStatusQuery = z.object({
  action: z.string().trim().min(1, '缺少 action'),
}).passthrough()

/**
 * GET /api/system/health
 * 立即执行一次全量巡检并返回本次结果
 * 同时将发现的问题持久化到 system_health_logs
 * 权限：需要登录（管理员角色建议在前端控制）
 */
router.get('/health', auth, requirePermission(PERMISSIONS.SYSTEM_HEALTH_VIEW), successRoute(
  () => runAllChecks(),
  '巡检完成',
))

/**
 * GET /api/system/health/logs?limit=100
 * 查询历史巡检日志明细（按 created_at 降序）
 */
router.get('/health/logs', auth, requirePermission(PERMISSIONS.SYSTEM_HEALTH_VIEW), validateQuery(limitQuery(100, 500)), successRoute(
  (req) => getRecentLogs(req.query.limit),
))

/**
 * GET /api/system/health/runs?limit=20
 * 查询历史巡检摘要（按 run_id 聚合，每次巡检一行）
 */
router.get('/health/runs', auth, requirePermission(PERMISSIONS.SYSTEM_HEALTH_VIEW), validateQuery(limitQuery(20, 100)), successRoute(
  (req) => getRunSummaries(req.query.limit),
))

/**
 * POST /api/system/health/autofix
 * 执行可自动修复的仓库流程异常（孤立资源释放）
 * 权限：需要登录
 */
router.post('/health/autofix', auth, requirePermission(PERMISSIONS.SYSTEM_HEALTH_AUTOFIX), successRoute(
  async () => {
    return runAutoFix('manual')
  },
  (result) => result.fixedCount > 0
    ? `自动修复完成，共修复 ${result.fixedCount} 项异常`
    : '巡检完成，未发现可自动修复的异常',
))

/**
 * GET /api/system/health/autofix/types
 * 查询当前支持自动修复的异常类型列表
 */
router.get('/health/autofix/types', auth, requirePermission(PERMISSIONS.SYSTEM_HEALTH_VIEW), successRoute(
  () => AUTO_FIXABLE_CHECK_TYPES,
))

router.get('/request-status/:requestKey', auth, validateParams(requestStatusParams), validateQuery(requestStatusQuery), successRoute(
  async (req) => {
    const action = String(req.query.action || '').trim()
    if (!action) throw new AppError('缺少 action', 400, 'BAD_REQUEST')
    const result = await getOperationRequestStatus({
      requestKey: req.params.requestKey,
      action,
      userId: req.user?.userId ?? null,
    })
    return result
  },
  'ok',
))

module.exports = router
