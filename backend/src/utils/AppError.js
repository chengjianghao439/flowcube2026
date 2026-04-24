/**
 * 业务异常类。
 * 凡是可预期的业务错误（参数不合法、资源不存在、权限不足等），
 * 均通过 throw new AppError(message, statusCode) 抛出。
 * 全局错误中间件会识别 isOperational 标识并返回对应 HTTP 状态码。
 */
class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode=400]
   * @param {string|Record<string, unknown>|null} [codeOrData]
   * @param {Record<string, unknown>|null} [data] 随错误返回给客户端的结构化数据（如 429 配额详情）
   */
  constructor(message, statusCode = 400, codeOrData = null, data = null) {
    super(message)
    this.statusCode = statusCode
    if (typeof codeOrData === 'string') {
      this.code = codeOrData
      this.data = data
    } else {
      this.code = null
      this.data = codeOrData
    }
    this.isOperational = true
    Error.captureStackTrace(this, this.constructor)
  }
}

module.exports = AppError
