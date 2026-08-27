/**
 * 极序 Flow 分级日志工具
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
const { getRequestContext } = require('./requestContext')

// ── 日志集中检索（P2-12）：配置 LOKI_URL 时把 warn/error 级日志异步推送到 Grafana Loki ──
// fire-and-forget：推送失败只记一条 console.error，绝不阻塞/影响业务。未配置则完全无副作用。
const LOKI_URL = String(process.env.LOKI_URL || '').trim()
const LOKI_LABELS = { app: 'flowcube-backend', env: process.env.NODE_ENV || 'development' }
function pushToLoki(level, msg, meta) {
  if (!LOKI_URL) return
  const line = JSON.stringify({ level, msg, meta: meta || {}, requestId: (getRequestContext() || {}).requestId || null })
  const body = JSON.stringify({ streams: [{ stream: LOKI_LABELS, values: [[String(Date.now() * 1000000), line]] }] })
  fetch(LOKI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(2000) })
    .catch((e) => console.error('[logger] loki push failed:', e?.message || String(e)))
}
function emit(level, msg, meta, module_) {
  if (level === 'warn' || level === 'error') pushToLoki(level, `[${module_}] ${msg}`, meta)
}

function timestamp() {
  // 北京时间字面量（+8h 偏移 + UTC 字段，不依赖进程 TZ）——日志时间与业务时区一致
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`
}

function fmt(level, module_, msg, meta) {
  const ctx = getRequestContext() || {}
  const mergedMeta = { ...(meta || {}) }
  if (ctx.requestId && !mergedMeta.requestId) {
    mergedMeta.requestId = ctx.requestId
  }
  const m = module_ ? `[${module_}] ` : ''
  const metaStr = mergedMeta && Object.keys(mergedMeta).length
    ? ' ' + JSON.stringify(mergedMeta)
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
    emit('warn', msg, meta, module_)
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
    emit('error', msg, { ...(err instanceof Error ? { err: err.message } : {}), ...(meta || {}) }, module_)
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
