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

  // 事件时间线表 + 物流轨迹（2026-08-22 扫描）：此前无任何 TTL，随业务量无界增长。
  // 事件表按 180 天清理（与流水一致）；EVENT_LOG_TTL_DAYS 可调。
  startWorker('event-log-cleanup', async () => {
    const days = num('EVENT_LOG_TTL_DAYS', 180)
    const tables = ['warehouse_task_events', 'sale_order_events', 'inbound_task_events', 'logistics_tracking_events']
    for (const t of tables) {
      await pool.query(`DELETE FROM \`${t}\` WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`, [days])
    }
  }, num('EVENT_LOG_CLEAN_INTERVAL_MS', 6 * 60 * 60 * 1000))

  // 电子面单（文档 06）：取号 worker + 轨迹 worker，均在事务外做 HTTP。
  // 可用 LOGISTICS_WORKER_ENABLED=0 关闭（如无快递平台对接的部署）。
  if (bool('LOGISTICS_WORKER_ENABLED', true)) {
    startWorker('waybill-fetch', runFetchWaybills, num('LOGISTICS_FETCH_INTERVAL_MS', 10 * 1000))
    startWorker('waybill-track', runTrackWaybills, num('LOGISTICS_TRACK_INTERVAL_MS', 60 * 1000))
    logger.info('[scheduler] 物流取号/轨迹 worker 已启动', {}, 'Scheduler')
  }

  // 循环盘点自动排程（文档08 Phase2）：每天跑一次，重算 ABC + 自动生成到期抽盘单。
  // 用「当天是否已跑」去重：进程启动后首个整点检查，若当天没跑过则立即跑一次（覆盖深夜启动场景），
  // 之后每小时检查一次直到当天跑过。可调 STOCKCHECK_CYCLE_INTERVAL_MS 控制检查频率。
  const { runAutoCycleScheduling } = require('./modules/stockcheck/stockcheck.cycle')
  let lastCycleDate = ''
  startWorker('stockcheck-cycle', async () => {
    // 本地日期（+08:00 部署）做「每天一次」判断，避免 UTC 跨日错位
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (lastCycleDate === today) return
    const r = await runAutoCycleScheduling()
    lastCycleDate = today
    logger.info(`[scheduler] 循环盘自动排程完成：${r.warehouses} 仓，生成 ${r.created.length} 张抽盘单${r.skipped.length ? `，跳过 ${r.skipped.length} 项` : ''}`, { created: r.created }, 'Scheduler')
  }, num('STOCKCHECK_CYCLE_INTERVAL_MS', 60 * 60 * 1000))
  logger.info('[scheduler] 循环盘自动排程 worker 已启动（每日一次，可 STOCKCHECK_CYCLE_INTERVAL_MS 调检查频率）', {}, 'Scheduler')

  // 库存/账款预警钉钉推送（2026-08-22 功能）：复用 buildNotifications 口径，
  // 命中高危事件（逾期应收应付/低于补货点/临期批次/呆滞）时推钉钉，管理层无需进系统。
  // 去重：按「类别+日期」记录，同类别当天只推一次（避免每轮扫描都刷屏）。
  // 配置 DINGTALK_ALERT_WEBHOOK 启用，未配置静默跳过。
  const { sendDingtalkAlert } = require('./utils/dingtalkAlert')
  let lastAlertDate = ''
  let alertedCodes = new Set()
  startWorker('dingtalk-alert', async () => {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (lastAlertDate !== today) {
      lastAlertDate = today
      alertedCodes = new Set()
    }
    const { buildNotifications } = require('./modules/notifications/notifications.service')
    const result = await buildNotifications(null)
    const DANGER_CODES = new Set(['OVERDUE_PAYABLE', 'OVERDUE_RECEIVABLE', 'LOW_STOCK', 'EXPIRING_STOCK', 'STALE_STOCK'])
    const targets = (result.items || []).filter(i => DANGER_CODES.has(i.code) && !alertedCodes.has(i.code))
    if (!targets.length) return
    const lines = targets.map(t => `- **${t.text}**（[查看](${t.path})）`)
    const ok = await sendDingtalkAlert(
      `⚠️ 极序 Flow 经营预警 ${today}`,
      `### 经营预警\n\n${lines.join('\n')}\n\n> 由系统自动推送，请及时处理。`,
    )
    if (ok) {
      for (const t of targets) alertedCodes.add(t.code)
      logger.info(`[scheduler] 钉钉预警已推送：${targets.map(t => t.code).join(',')}`, {}, 'Scheduler')
    }
  }, num('DINGTALK_ALERT_INTERVAL_MS', 30 * 60 * 1000))
  logger.info('[scheduler] 钉钉预警 worker 已启动（30 分钟扫描，DINGTALK_ALERT_WEBHOOK 未配置则静默）', {}, 'Scheduler')
}

module.exports = { startScheduler }
