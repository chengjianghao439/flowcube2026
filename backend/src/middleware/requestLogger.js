/**
 * requestLogger — HTTP 请求日志中间件
 *
 * 每个请求记录：
 *  - 请求方法 + 路径
 *  - 操作人 userId（JWT 解析后才有，GET 请求也记录）
 *  - 响应状态码
 *  - 执行耗时（ms）
 *
 * 慢接口：响应时间 > SLOW_MS 时自动 warn
 * 错误响应：状态码 >= 500 时额外 error 日志
 */

const logger = require('../utils/logger')

function requestLogger(req, res, next) {
  const start = Date.now()

  // 在响应结束后记录（finish 事件确保状态码已写入）
  res.on('finish', () => {
    const ms = Date.now() - start
    const userId = req.user?.userId ?? '-'
    const method = req.method
    const path   = req.originalUrl || req.path
    const status = res.statusCode

    const meta = { ms, status, userId }

    if (status >= 500) {
      logger.error(`${method} ${path}`, null, meta, 'HTTP')
    } else if (status >= 400) {
      logger.warn(`${method} ${path}`, meta, 'HTTP')
    } else {
      logger.info(`${method} ${path}`, meta, 'HTTP')
    }

    // 慢接口告警
    logger.slowApi(method, path, ms)
  })

  next()
}

module.exports = requestLogger
