'use strict'
const { successResponse, errorResponse } = require('./response')

/** 公开就绪探针只返回状态；短缓存与单次在途探测限制重复请求的数据库开销。 */
function createReadinessHandler(pool, { timeoutMs = 2000, cacheMs = 1000 } = {}) {
  let pending = null
  let cached = null
  let expires = 0
  const probe = async () => {
    let conn, timer, timedOut = false
    const work = (async () => {
      conn = await pool.getConnection({ timeoutMs })
      if (timedOut) { conn.release(); conn = null; return false }
      await conn.query('SELECT 1 AS ready')
      return true
    })()
    try {
      return await Promise.race([work, new Promise(resolve => {
        timer = setTimeout(() => {
          timedOut = true
          if (conn) { conn.destroy(); conn = null }
          resolve(false)
        }, timeoutMs)
      })])
    } catch { return false } finally {
      clearTimeout(timer)
      if (conn) conn.release()
    }
  }
  return async (_req, res) => {
    if (!cached || Date.now() >= expires) {
      if (!pending) pending = probe().then(ready => {
        cached = { ready }
        expires = Date.now() + cacheMs
        return cached
      }).finally(() => { pending = null })
      await pending
    }
    if (cached.ready) return successResponse(res, { status: 'ready' }, 'ready')
    return errorResponse(res, '服务暂不可用', 503, { status: 'unavailable' }, 'NOT_READY')
  }
}

module.exports = { createReadinessHandler }
