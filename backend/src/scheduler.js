/**
 * 极序 Flow 定时任务调度器
 */

const { startCleanupSweeper } = require('./utils/operationRequest')
const { pool } = require('./config/db')
const logger = require('./utils/logger')
const { beijingTodayYmd } = require('./utils/backendTime')
const { runWithRequestContext } = require('./utils/requestContext')
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
 * 2026-08-22 加固：每轮 tick 注入 scheduler:<name> 的 requestId 上下文，
 * 让 worker 内所有 logger 输出可追溯到具体调度任务。
 */
function startWorker(name, fn, intervalMs) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runWithRequestContext({ requestId: `scheduler:${name}` }, fn)
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

  // PDA 设备会话 TTL（2026-08-22 扫描）：过期/吊销会话无清理任务，表随设备数缓慢膨胀。
  // 只清「已过期且 30 天前」的记录——活跃会话靠心跳续期，不会误删。
  startWorker('pda-session-cleanup', async () => {
    await pool.query(
      'DELETE FROM pda_device_sessions WHERE (expires_at < NOW() OR revoked_at IS NOT NULL) AND updated_at < DATE_SUB(NOW(), INTERVAL 30 DAY)',
    )
  }, num('PDA_SESSION_CLEAN_INTERVAL_MS', 24 * 60 * 60 * 1000))

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
    // 北京时间的「今天」做每天一次判断（显式 backendTime，不依赖进程 TZ）
    const today = beijingTodayYmd()
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
    const today = beijingTodayYmd()
    if (lastAlertDate !== today) {
      lastAlertDate = today
      alertedCodes = new Set()
    }
    const { buildNotifications } = require('./modules/notifications/notifications.service')
    const result = await buildNotifications(null)
    const DANGER_CODES = new Set(['OVERDUE_PAYABLE', 'OVERDUE_RECEIVABLE', 'LOW_STOCK', 'EXPIRING_STOCK', 'STALE_STOCK'])
    const targets = (result.items || []).filter(i => DANGER_CODES.has(i.code) && !alertedCodes.has(i.code))
    if (!targets.length) return
    // 【钉钉「查看」链接 2026-08-28】钉钉客户端只认绝对 http(s) URL，且前端是 HashRouter：
    // 必须拼成 https://<APP_PUBLIC_URL>/#/<path> 才是可点的真实链接。此前直接写 t.path
    // （相对路径 /payments/payable），钉钉解析成自己域下的无效相对链接——电脑端点开
    // 无反应、手机端显示无法连接。APP_PUBLIC_URL 生产必填（config/env.js 校验）。
    const publicUrl = String(process.env.APP_PUBLIC_URL || '').replace(/\/$/, '')
    const alertLink = (path) => {
      const p = (path || '').startsWith('/') ? path : `/${path || ''}`
      return publicUrl ? `${publicUrl}/#${p}` : p
    }
    const lines = targets.map(t => `- **${t.text}**（[查看](${alertLink(t.path)})）`)
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

  // 库存缓存漂移巡检（2026-08-25）：缓存(投影)与容器(事实源)失联时,业务判断会静默出错。
  // 每 30 分钟跑一次 findStockDrift,发现漂移推钉钉,人工经成本对账页「修复缓存」或 resync 处理。
  // 与 dingtalk-alert 复用同一 webhook;去重:同一天只推一次,避免每轮扫描都刷屏。
  // 注意:巡检只报警不自动修——漂移是「机制失效」信号,自动改可能掩盖根因。
  let lastDriftAlertDate = ''
  startWorker('stock-drift-check', async () => {
    const today = beijingTodayYmd()
    const { findStockDrift } = require('./modules/inventory/inventory.service')
    const { list } = await findStockDrift({})
    const drifted = list.filter(r => r.drifted)
    if (!drifted.length) return
    if (lastDriftAlertDate === today) return
    const totalDiffValue = Math.round(drifted.reduce((s, r) => s + r.diffValue, 0) * 100) / 100
    const top = drifted.slice(0, 5).map(r => `- ${r.productName}（仓 ${r.warehouseId}）缓存 ${r.cacheQty} / 容器 ${r.containerQty}，差 ${r.diffQty}`)
    const ok = await sendDingtalkAlert(
      `🔴 极序 Flow 库存缓存漂移 ${today}`,
      `### 发现 ${drifted.length} 项缓存漂移,总价值差 ¥${totalDiffValue.toLocaleString('zh-CN')}\n\n${top.join('\n')}${drifted.length > 5 ? `\n- …共 ${drifted.length} 项` : ''}\n\n> 请在「报表 → 库存分析 → 成本对账」查看明细并点击「修复缓存」。`,
    )
    if (ok) {
      lastDriftAlertDate = today
      logger.warn(`[scheduler] 库存缓存漂移告警已推送：${drifted.length} 项`, { top }, 'Scheduler')
    }
  }, num('STOCK_DRIFT_CHECK_INTERVAL_MS', 30 * 60 * 1000))
  logger.info('[scheduler] 库存缓存漂移巡检 worker 已启动（30 分钟扫描，DINGTALK_ALERT_WEBHOOK 未配置则静默）', {}, 'Scheduler')
}

module.exports = { startScheduler }
