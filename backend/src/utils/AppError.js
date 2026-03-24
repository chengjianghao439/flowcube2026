/**
 * 业务异常类。
 * 凡是可预期的业务错误（参数不合法、资源不存在、权限不足等），
 * 均通过 throw new AppError(message, statusCode) 抛出。
 * 全局错误中间件会识别 isOperational 标识并返回对应 HTTP 状态码。
 */
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true
    Error.captureStackTrace(this, this.constructor)
  }
}

module.exports = AppError
