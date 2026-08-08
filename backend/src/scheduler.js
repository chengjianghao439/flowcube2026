/**
 * 极序 Flow 定时任务调度器
 */

const { startCleanupSweeper } = require('./utils/operationRequest')
const { pool } = require('./config/db')
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

  // 操作日志（operation_logs）无界增长修复：每 6 小时清理 30 天前的记录。
  // 此前 clearOld 只有手动触发（OPLOGS_CLEAR_TTL_DAYS 可调），日志表会无限膨胀。
  const { clearOld: clearOpLogs } = require('./modules/oplogs/oplogs.service')
  startWorker('oplogs-cleanup', clearOpLogs, num('OPLOGS_CLEAN_INTERVAL_MS', 6 * 60 * 60 * 1000))

  // 扫码流水 / 库存流水：无界增长修复。报表只查短期窗口（PDA 性能查 6 天、仓库运营查当天、
  // 库存周转查日期区间），180 天前的流水无业务展示用途，定期清理。
  // SCAN_LOG_TTL_DAYS / INVENTORY_LOG_TTL_DAYS 可调，默认 180 天。
  startWorker('scan-log-cleanup', async () => {
    const days = num('SCAN_LOG_TTL_DAYS', 180)
    await pool.query('DELETE FROM scan_logs WHERE scanned_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [days])
  }, num('SCAN_LOG_CLEAN_INTERVAL_MS', 6 * 60 * 60 * 1000))
  startWorker('inventory-log-cleanup', async () => {
    const days = num('INVENTORY_LOG_TTL_DAYS', 180)
    await pool.query('DELETE FROM inventory_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [days])
  }, num('INVENTORY_LOG_CLEAN_INTERVAL_MS', 6 * 60 * 60 * 1000))

  // 电子面单（文档 06）：取号 worker + 轨迹 worker，均在事务外做 HTTP。
  // 可用 LOGISTICS_WORKER_ENABLED=0 关闭（如无快递平台对接的部署）。
  if (bool('LOGISTICS_WORKER_ENABLED', true)) {
    startWorker('waybill-fetch', runFetchWaybills, num('LOGISTICS_FETCH_INTERVAL_MS', 10 * 1000))
    startWorker('waybill-track', runTrackWaybills, num('LOGISTICS_TRACK_INTERVAL_MS', 60 * 1000))
    logger.info('[scheduler] 物流取号/轨迹 worker 已启动', {}, 'Scheduler')
  }
}

module.exports = { startScheduler }
