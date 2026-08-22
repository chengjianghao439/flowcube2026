const { successResponse } = require('../../utils/response')
const { getOperationRequestStatus } = require('../../utils/operationRequest')
const logger = require('../../utils/logger')

/**
 * 查询一次关键操作的提交回执。
 *
 * PDA 的关键动作（收货/上架/拣货/复核/打包/出库/调拨/退货）在提交前会先写一条
 * operation_requests 记录，网络中断导致「提交出去了但没收到响应」时，前端靠这个接口
 * 回来问服务端「我那次到底成没成」，而不是让员工凭经验决定要不要重扫。
 *
 * 只能查自己的回执：底层按 (request_key, action, user_id) 三元组匹配，
 * user_id 取自 JWT，不接受调用方传入，因此不存在越权查他人操作结果的路径。
 */
const requestStatus = async (req, res, next) => {
  try {
    const data = await getOperationRequestStatus({
      requestKey: req.params.key,
      action: req.query.action,
      userId: req.user?.userId ?? null,
    })
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

/**
 * 前端错误上报（P2-12 错误追踪）：GlobalErrorBoundary 捕获 render 错误时调用。
 * 用 logger.error 记录 → 配置了 LOKI_URL 时自动进 Loki（与后端错误同一检索源）。
 * 只记一条 warn 级日志，绝不抛错影响响应。
 *
 * 加固（2026-08-22）：url 剥查询串（防 query 里的敏感参数进日志）；stack 截断+脱敏字符。
 */
const reportError = async (req, res, next) => {
  try {
    const { message, stack, componentStack, url } = req.body || {}
    const safeUrl = String(url || '').split('?')[0].slice(0, 500)
    const sanitize = s => String(s || '').replace(/[^\x20-\x7E一-龥]/g, '?').slice(0, 2000)
    logger.error('[frontend-error] ' + String(message || '未知前端错误').slice(0, 500),
      { url: safeUrl, stack: sanitize(stack), componentStack: sanitize(componentStack) },
      { module: 'frontend' },
    )
    return successResponse(res, null, '已记录')
  } catch (e) { next(e) }
}

module.exports = { requestStatus, reportError }
