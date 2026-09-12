// 进程内提示队列：不持久化业务事实，丢失或溢出由周期扫描兜底。
const TYPES = new Set(['sale', 'purchase', 'inbound', 'transfer', 'warehouse', 'stock'])
function createRefreshQueue({ process, now = Date.now, capacity = 1000, batchSize = 25, budgetMs = 250 } = {}) {
  const jobs = new Map()
  let running = false
  const metrics = { merged: 0, overflow: 0, succeeded: 0, failed: 0, exhausted: 0, lastSuccessAt: null, lastFailureAt: null, lastDurationMs: null }
  function notify(type, id, expand = true) {
    if (!TYPES.has(type)) return false
    if (type === 'stock') {
      if (typeof id !== 'string' || !/^[1-9]\d*:[1-9]\d*$/.test(id) || !id.split(':').every(value => Number.isSafeInteger(Number(value)))) return false
    } else {
      id = Number(id)
      if (!Number.isSafeInteger(id) || id < 1) return false
    }
    const key = `${type}:${id}`
    const existing = jobs.get(key)
    if (existing) {
      if (expand) {
        // 直接业务变化意味着依赖集合可能变化，必须重新检测并从首页展开。
        existing.version++; existing.cursor = 0; existing.expand = true
        existing.refreshPending = false
      } else if (existing.expand) {
        // 依赖只要求复检自身，不能打断直接任务的展开游标，否则同维度任务互相通知不收敛。
        if (existing.inFlight || existing.cursor) existing.refreshPending = true
      } else if (existing.inFlight) {
        // 自身检测运行期间的新依赖变化仍须再检一次。
        existing.version++
      }
      metrics.merged++
      return true
    }
    if (jobs.size >= capacity) { metrics.overflow++; return false }
    jobs.set(key, { type, id, expand, cursor: 0, version: 1, attempts: 0, inFlight: false, refreshPending: false, queuedAt: now(), readyAt: now() })
    return true
  }
  async function run() {
    if (running) return
    running = true
    const started = now()
    try {
      // 固定快照；本轮中新通知留至下轮，防高频更新饿死其他单据。
      const ready = [...jobs.entries()].filter(([, job]) => job.readyAt <= started).slice(0, batchSize)
      for (const [key, job] of ready) {
        if (now() - started >= budgetMs) break
        const version = job.version, attemptStarted = now()
        job.inFlight = true
        let nextCursor = null
        try {
          nextCursor = await process({ ...job })
          metrics.succeeded++; metrics.lastSuccessAt = now()
          job.attempts = 0; job.readyAt = now()
          if (job.version === version) job.cursor = nextCursor || 0
          if (job.version === version && nextCursor == null) {
            if (job.refreshPending) {
              // 展开结束后补一次自身检测；不重复依赖查询。
              job.expand = false; job.refreshPending = false
            } else jobs.delete(key)
          }
        } catch {
          metrics.failed++; metrics.lastFailureAt = now()
          job.attempts++
          if (job.attempts >= 3 && job.version === version) { jobs.delete(key); metrics.exhausted++ }
          else {
            if (job.version !== version) job.attempts = 0
            job.readyAt = now() + 1000 * 2 ** Math.max(0, job.attempts - 1)
          }
        } finally {
          job.inFlight = false
          metrics.lastDurationMs = Math.max(0, now() - attemptStarted)
          // 未完成项移到队尾，依赖很多的单据不会长期占据首批。
          if (jobs.has(key)) { jobs.delete(key); jobs.set(key, job) }
        }
      }
    } finally { running = false }
  }
  function stats() {
    return { ...metrics, pending: jobs.size, running, capacity, batchSize,
      oldestPendingMs: jobs.size ? Math.max(0, now() - Math.min(...[...jobs.values()].map(j => j.queuedAt))) : 0 }
  }
  return { notify, run, stats }
}
function createCommitNotifier(notify, recordSnapshotOverflow = () => {}) {
  return async (conn, type, id, previousDimensions) => {
    await conn.commit()
    // 通知只是可丢弃的提示；不得将已成功的业务提交误报失败。
    try {
      notify(type, id)
      for (const pair of previousDimensions?.pairs || []) notify('stock', pair)
      if (previousDimensions?.truncated) recordSnapshotOverflow()
    } catch { /* 周期扫描修复漏通知 */ }
  }
}
module.exports = { createRefreshQueue, createCommitNotifier }
