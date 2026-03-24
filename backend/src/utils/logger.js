/**
 * FlowCube 分级日志工具
 *
 * 级别：info → warn → error
 * 格式：[时间戳] [级别] [模块] 消息 {meta}
 * 生产环境：info 以上全部输出
 * 开发环境：同上 + 错误堆栈
 *
 * 慢接口阈值：SLOW_MS（默认 800ms）
 */

const IS_DEV = process.env.NODE_ENV !== 'production'
const SLOW_MS = parseInt(process.env.SLOW_API_MS || '800', 10)

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

function fmt(level, module_, msg, meta) {
  const m = module_ ? `[${module_}] ` : ''
  const metaStr = meta && Object.keys(meta).length
    ? ' ' + JSON.stringify(meta)
    : ''
  return `[${timestamp()}] [${level}] ${m}${msg}${metaStr}`
}

const logger = {
  /**
   * 常规信息
   * @param {string} msg
   * @param {object} [meta]
   * @param {string} [module_]
   */
  info(msg, meta = {}, module_ = '') {
    console.log(fmt('INFO ', module_, msg, meta))
  },

  /**
   * 警告（慢接口、数据异常等）
   * @param {string} msg
   * @param {object} [meta]
   * @param {string} [module_]
   */
  warn(msg, meta = {}, module_ = '') {
    console.warn(fmt('WARN ', module_, msg, meta))
  },

  /**
   * 错误（业务异常、系统错误）
   * @param {string} msg
   * @param {Error|object} [err]
   * @param {object} [meta]
   * @param {string} [module_]
   */
  error(msg, err = null, meta = {}, module_ = '') {
    const base = fmt('ERROR', module_, msg, meta)
    if (err instanceof Error) {
      const stack = IS_DEV ? `\n${err.stack}` : ` (${err.message})`
      console.error(base + stack)
    } else {
      console.error(base, err || '')
    }
  },

  /**
   * 慢接口自动警告（在 requestLogger 中调用）
   * @param {string} method
   * @param {string} path
   * @param {number} ms
   */
  slowApi(method, path, ms) {
    if (ms >= SLOW_MS) {
      logger.warn(`慢接口 ${method} ${path} 耗时 ${ms}ms（阈值 ${SLOW_MS}ms）`, { ms, path }, 'PERF')
    }
  },
}

module.exports = logger
