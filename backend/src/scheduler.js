/**
 * 极序 Flow 定时任务调度器
 */

const { startCleanupSweeper } = require('./utils/operationRequest')
const logger = require('./utils/logger')
const { runFetchWaybills, runTrackWaybills } = require('./modules/logistics/logistics.worker')

const num = (name, def) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : def
}
const bool = (name, def) => {
  const raw = String(process.env[name] || '').trim().toLowerCase()
  if (!raw) return def
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

/**
 * 事务外异步 worker 的通用启动器：带"上一轮未跑完就跳过本轮"的重入保护，
 * 避免慢平台/长队列时多轮任务叠加。worker 自身已捕获异常，这里再兜一层。
 */
function startWorker(name, fn, intervalMs) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await fn()
    } catch (e) {
      logger.error(`[scheduler] ${name} 执行异常`, e, {}, 'Scheduler')
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, intervalMs)
  if (timer.unref) timer.unref()
  return timer
}

function startScheduler() {
  // 每 6 小时清理超过 7 天的 operation_requests 记录
  startCleanupSweeper({ intervalMs: 6 * 60 * 60 * 1000, ttlDays: 7 })

  // 电子面单（文档 06）：取号 worker + 轨迹 worker，均在事务外做 HTTP。
  // 可用 LOGISTICS_WORKER_ENABLED=0 关闭（如无快递平台对接的部署）。
  if (bool('LOGISTICS_WORKER_ENABLED', true)) {
    startWorker('waybill-fetch', runFetchWaybills, num('LOGISTICS_FETCH_INTERVAL_MS', 10 * 1000))
    startWorker('waybill-track', runTrackWaybills, num('LOGISTICS_TRACK_INTERVAL_MS', 60 * 1000))
    logger.info('[scheduler] 物流取号/轨迹 worker 已启动', {}, 'Scheduler')
  }
}

module.exports = { startScheduler }
