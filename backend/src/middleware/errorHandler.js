const AppError = require('../utils/AppError')
const logger   = require('../utils/logger')
const { errorResponse } = require('../utils/response')

function defaultErrorCode(statusCode, fallback = 'INTERNAL_ERROR') {
  if (statusCode === 400) return 'BAD_REQUEST'
  if (statusCode === 401) return 'UNAUTHORIZED'
  if (statusCode === 403) return 'FORBIDDEN'
  if (statusCode === 404) return 'NOT_FOUND'
  if (statusCode === 409) return 'CONFLICT'
  if (statusCode === 422) return 'VALIDATION_ERROR'
  return fallback
}

/**
 * 全局错误处理中间件（4 个参数，必须最后注册）
 * 处理顺序：AppError（业务错误）→ MySQL 错误 → Zod 校验 → 未知错误
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const path   = req.originalUrl || req.path
  const userId = req.user?.userId ?? '-'
  const refNo  = req.body?.orderNo || req.body?.ref_no || req.params?.id || ''
  const requestId = req.requestId || null

  // ── 业务异常（可预期，不记录 error 级别）──────────────────────────────────
  if (err instanceof AppError && err.isOperational) {
    const errorCode = err.code || defaultErrorCode(err.statusCode, 'BUSINESS_ERROR')
    logger.warn(`[AppError] ${err.message}`, { path, userId, refNo, requestId, code: errorCode, statusCode: err.statusCode }, 'ERR')
    return errorResponse(res, err.message, err.statusCode, err.data ?? null, errorCode)
  }

  // ── MySQL 唯一约束 ────────────────────────────────────────────────────────
  if (err.code === 'ER_DUP_ENTRY') {
    logger.warn('数据重复提交', { path, userId, requestId, code: 'DUPLICATE_ENTRY' }, 'DB')
    return errorResponse(res, '数据已存在，请勿重复提交', 400, null, 'DUPLICATE_ENTRY')
  }

  // ── MySQL 外键约束 ────────────────────────────────────────────────────────
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    logger.warn('外键约束冲突', { path, userId, requestId, code: 'FK_CONFLICT' }, 'DB')
    return errorResponse(res, '该数据正在被其他记录引用，无法删除', 400, null, 'FK_CONFLICT')
  }

  // ── Zod 校验错误 ─────────────────────────────────────────────────────────
  if (err.name === 'ZodError') {
    const message = err.errors.map((e) => e.message).join('；')
    logger.warn(`[ZodError] ${message}`, { path, userId, requestId, code: 'VALIDATION_ERROR' }, 'VALID')
    return errorResponse(res, message, 400, null, 'VALIDATION_ERROR')
  }

  if (err.code === 'ER_NO_SUCH_TABLE') {
    logger.error(`[MySQL] 缺表: ${err.message}`, err, { path, userId, requestId }, 'DB')
    return errorResponse(
      res,
      '数据库缺少业务表（可能未执行迁移或库为新库）。请在后端日志中确认迁移是否成功，或从旧环境恢复数据备份。',
      500,
      null,
      'DB_TABLE_MISSING',
    )
  }

  if (err.code === 'ER_BAD_FIELD_ERROR') {
    logger.error(`[MySQL] 缺列: ${err.message}`, err, { path, userId, requestId }, 'DB')
    return errorResponse(
      res,
      '数据库字段与当前程序版本不一致（请先部署最新代码并确保迁移已跑完）。详情见后端日志。',
      500,
      null,
      'DB_COLUMN_MISMATCH',
    )
  }

  // ── 未知错误（记录完整堆栈）──────────────────────────────────────────────
  logger.error(`[Unhandled] ${err.message || '未知错误'}`, err, { path, userId, refNo, requestId }, 'ERR')
  const expose = ['1', 'true', 'yes'].includes(String(process.env.APP_EXPOSE_ERRORS || '').toLowerCase())
  const message =
    expose && err.message
      ? `${err.message}${err.code ? ` (${err.code})` : ''}`.trim()
      : '服务器内部错误'
  return errorResponse(res, message, 500, null, 'INTERNAL_ERROR')
}

module.exports = errorHandler
