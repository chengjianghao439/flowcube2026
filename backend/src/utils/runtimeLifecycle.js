'use strict'
const { errorResponse } = require('./response')

/** One process-wide owner for periodic work, including module-load sweepers. */
function createRuntimeLifecycle({
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
} = {}) {
  let draining = false
  const tasks = new Map(), active = new Set()
  return {
    isDraining: () => draining,
    beginDrain() { draining = true },
    startTask(name, fn, intervalMs, { immediate = false, initialDelayMs = 0, onError = error => console.error(`[${name}]`, error) } = {}) {
      if (draining || tasks.has(name)) return
      let running = false
      const tick = () => {
        if (draining || running) return Promise.resolve()
        running = true
        const work = Promise.resolve().then(fn).catch(onError).finally(() => {
          running = false
          active.delete(work)
        })
        active.add(work)
        // Interval callbacks have no caller to observe a rejected logging callback.
        void work.catch(() => {})
        return work
      }
      const task = {}
      tasks.set(name, task)
      const start = () => {
        if (draining || tasks.get(name) !== task) return
        const timer = setIntervalFn(tick, intervalMs)
        timer.unref?.()
        task.cancel = () => clearIntervalFn(timer)
        if (immediate) void tick()
      }
      if (initialDelayMs > 0) {
        const timer = setTimeoutFn(start, initialDelayMs)
        timer.unref?.()
        task.cancel = () => clearTimeoutFn(timer)
      } else {
        start()
      }
    },
    stopTasks() {
      draining = true
      for (const task of tasks.values()) task.cancel?.()
      tasks.clear()
    },
    async waitForTasks() {
      const results = await Promise.allSettled([...active])
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) throw new AggregateError(errors, '后台任务退出失败')
    },
  }
}

const lifecycle = createRuntimeLifecycle()
function createDrainMiddleware(runtime = lifecycle) {
  return (_req, res, next) => {
    if (!runtime.isDraining()) return next()
    res.set('Connection', 'close')
    return errorResponse(res, '服务正在停止，请稍后重试', 503, null, 'SERVER_DRAINING')
  }
}
module.exports = { createRuntimeLifecycle, lifecycle, createDrainMiddleware }
