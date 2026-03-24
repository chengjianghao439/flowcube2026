const AppError = require('../utils/AppError')
const logger   = require('../utils/logger')
const { errorResponse } = require('../utils/response')

/**
 * 全局错误处理中间件（4 个参数，必须最后注册）
 * 处理顺序：AppError（业务错误）→ MySQL 错误 → Zod 校验 → 未知错误
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const path   = req.originalUrl || req.path
  const userId = req.user?.userId ?? '-'
  const refNo  = req.body?.orderNo || req.body?.ref_no || req.params?.id || ''

  // ── 业务异常（可预期，不记录 error 级别）──────────────────────────────────
  if (err instanceof AppError && err.isOperational) {
    logger.warn(`[AppError] ${err.message}`, { path, userId, refNo, code: err.statusCode }, 'ERR')
    return errorResponse(res, err.message, err.statusCode)
  }

  // ── MySQL 唯一约束 ────────────────────────────────────────────────────────
  if (err.code === 'ER_DUP_ENTRY') {
    logger.warn('数据重复提交', { path, userId }, 'DB')
    return errorResponse(res, '数据已存在，请勿重复提交', 400)
  }

  // ── MySQL 外键约束 ────────────────────────────────────────────────────────
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    logger.warn('外键约束冲突', { path, userId }, 'DB')
    return errorResponse(res, '该数据正在被其他记录引用，无法删除', 400)
  }

  // ── Zod 校验错误 ─────────────────────────────────────────────────────────
  if (err.name === 'ZodError') {
    const message = err.errors.map((e) => e.message).join('；')
    logger.warn(`[ZodError] ${message}`, { path, userId }, 'VALID')
    return errorResponse(res, message, 400)
  }

  // ── 未知错误（记录完整堆栈）──────────────────────────────────────────────
  logger.error(`[Unhandled] ${err.message || '未知错误'}`, err, { path, userId, refNo }, 'ERR')
  return errorResponse(res, '服务器内部错误', 500)
}

module.exports = errorHandler
