'use strict'
const AppError = require('./AppError')

/**
 * mysql2 的 connectTimeout 不包含池排队。只在取得连接后派发 SQL，
 * 超期的获取回调归还迟到连接，不能让已返回503的排队写入稍后继续执行。
 * 已经开始的 SQL/事务保持原语义，不用 Promise.race 伪装业务取消。
 */
function boundPoolAcquisition(pool, { timeoutMs = 5000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('连接获取时限必须为正整数')
  const acquire = pool.getConnection.bind(pool)
  const stats = { waiting: 0, timeouts: 0, rejected: 0, maxWaitMs: 0 }
  pool.getAcquisitionStats = () => ({ ...stats })
  pool.getConnection = (options = {}) => {
    const requested = options?.timeoutMs
    const limit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, timeoutMs) : timeoutMs
    return new Promise((resolve, reject) => {
      let finished = false
      const started = performance.now()
      stats.waiting++
      const finish = () => {
        finished = true
        stats.waiting--
        stats.maxWaitMs = Math.max(stats.maxWaitMs, Math.round(performance.now() - started))
        clearTimeout(timer)
      }
      const timer = setTimeout(() => {
        finish()
        stats.timeouts++
        reject(new AppError('服务繁忙，数据库连接等待超时，请稍后重试', 503, 'DB_ACQUIRE_TIMEOUT'))
      }, limit)
      Promise.resolve().then(acquire).then(conn => {
        if (finished) { conn.release(); return }
        finish()
        resolve(conn)
      }, error => {
        if (finished) return
        finish()
        stats.rejected++
        reject(error.message === 'Queue limit reached.'
          ? new AppError('服务繁忙，数据库连接队列已满，请稍后重试', 503, 'DB_POOL_QUEUE_LIMIT')
          : error)
      })
    })
  }
  for (const method of ['query', 'execute']) {
    pool[method] = async (...args) => {
      const conn = await pool.getConnection()
      try { return await conn[method](...args) } finally { conn.release() }
    }
  }
  return pool
}

module.exports = { boundPoolAcquisition }
