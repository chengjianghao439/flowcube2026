const AppError = require('../utils/AppError')
const { MulterError } = require('multer')
const logger   = require('../utils/logger')
const { errorResponse } = require('../utils/response')
const { env } = require('../config/env')
const { initializeErrorTracking, captureUnexpectedError } = require('../utils/errorTracking')
initializeErrorTracking({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV })

/**
 * 全局错误处理中间件（4 个参数，必须最后注册）
 * 处理顺序：AppError（业务错误）→ MySQL 错误 → Zod 校验 → 未知错误
 */
// Express 按「形参个数是否为 4」识别错误中间件：next 必须留在签名里，删掉它就静默变成普通中间件、错误再也进不来
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const path   = req.originalUrl || req.path
  const userId = req.user?.userId ?? '-'
  const refNo  = req.body?.orderNo || req.body?.ref_no || req.params?.id || ''
  const requestId = req.requestId || null

  // 单文件上传的字段/文件数量限制属于预期输入错误，不能记作服务器异常。
  if (err instanceof MulterError && ['LIMIT_FIELD_COUNT', 'LIMIT_FILE_COUNT'].includes(err.code)) {
    err = new AppError('仅支持上传一个文件，请移除额外文件或表单字段', 400, err.code)
  }

  // ── 请求体解析失败（body-parser）────────────────────────────────────────
  // 2026-09-17 验收修复：畸形 JSON（如 '{}{}'）此前落到「未知错误」分支，
  // 返回 500「服务器内部错误」并打完整堆栈。这是客户端输入错误，必须是 400。
  // 未鉴权端点也能触发，记成 ERR 会污染错误日志与错误追踪。
  if (err.type === 'entity.parse.failed') {
    logger.warn('请求体不是合法 JSON', { path, userId, requestId, code: 'BAD_REQUEST' }, 'ERR')
    return errorResponse(res, '请求体不是合法的 JSON', 400, null, 'BAD_REQUEST')
  }
  if (err.type === 'entity.too.large') {
    logger.warn('请求体超过大小限制', { path, userId, requestId, code: 'PAYLOAD_TOO_LARGE' }, 'ERR')
    return errorResponse(res, '请求体过大', 413, null, 'PAYLOAD_TOO_LARGE')
  }

  // ── 业务异常（可预期，不记录 error 级别）──────────────────────────────────
  if (err instanceof AppError && err.isOperational) {
    // 只在业务代码显式给了 code 时才带 code。此前对未带 code 的 4xx 兜底
    // CONFLICT/BAD_REQUEST 之类的通用码，前端会优先用通用码覆盖后端中文原因，
    // 把「箱贴仍待确认…请先收口打印任务」「该容器 5 件超出调拨单剩余可调量 1 件」
    // 这类可操作提示统一显示成「状态已变化，请刷新后重试」（2026-09-17 验收
    // ISSUE-003 / ISSUE-016：现场反复刷新永远无效）。保留 message 保真，
    // 调用方仍可自行生成 code（如 AppError 第三参数）。
    const errorCode = err.code || null
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
  // 不把实际 URL/query、请求体或用户资料发送到错误追踪服务。
  try {
    captureUnexpectedError(err, { requestId, method: req.method, route: req.route?.path })
  } catch (trackingError) {
    logger.warn('Sentry 上报失败', { err: trackingError?.message }, 'SENTRY')
  }
  const expose = ['1', 'true', 'yes'].includes(String(process.env.APP_EXPOSE_ERRORS || '').toLowerCase())
  const message =
    expose && err.message
      ? `${err.message}${err.code ? ` (${err.code})` : ''}`.trim()
      : '服务器内部错误'
  return errorResponse(res, message, 500, null, 'INTERNAL_ERROR')
}

module.exports = errorHandler
