/**
 * 极序 Flow 定时任务调度器
 */

const { lifecycle } = require('./utils/runtimeLifecycle')
const { startCleanupSweeper } = require('./utils/operationRequest')
const { pool } = require('./config/db')
const { cleanupRetentionRows } = require('./utils/retentionCleanup')

const RETENTION_INTERVAL_MS = 15 * 60 * 1000
const logger = require('./utils/logger')
const { beijingTodayYmd } = require('./utils/backendTime')
const { runWithRequestContext } = require('./utils/requestContext')
const { runFetchWaybills, runTrackWaybills } = require('./modules/logistics/logistics.worker')
const { cleanupSessionFamilies } = require('./modules/auth/sessionFamilies')

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
function startWorker(name, fn, intervalMs, options = {}) {
  lifecycle.startTask(`scheduler:${name}`, () => runWithRequestContext({ requestId: `scheduler:${name}` }, fn), intervalMs, {
    ...options,
    onError: e => logger.error(`[scheduler] ${name} 执行异常`, e, {}, 'Scheduler'),
  })
}

function startScheduler() {
  const { runFulfillmentSync } = require('./modules/fulfillment/fulfillment.worker')
  startWorker('order-fulfillment', runFulfillmentSync, 30 * 1000)
  const { runFulfillmentRefresh } = require('./modules/fulfillment/fulfillment.refresh')
  startWorker('order-fulfillment-refresh', runFulfillmentRefresh, 1000)

  startCleanupSweeper({ intervalMs: 60 * 1000, ttlDays: 7 })

  // 跨期补录的调整凭证自动补齐（2026-09-26 一致性审查 · 任务 7）。
  // 补录执行分两步：业务写入在业务事务内，调整凭证要全期间重算、只能在其后单独做。凭证这一步
  // 失败会留下「钱已动、会计账上没有」的申请单——只靠审批页的重试按钮等人来点，这个状态会一直
  // 挂着（出纳以为走完了、审批人以为批完了，没人回头看）。这里定期扫一遍让它自己收敛。
  // 注意：期间已结账这类原因不会自愈，会持续停在错误上等人工——那是刻意的，系统不该自己
  // 替会计决定去动一个已封的期间。间隔可用 BACKFILL_VOUCHER_RETRY_INTERVAL_MS 调整。
  const { retryPendingVoucherGeneration } = require('./modules/accounting/finance-backfills.service')
  startWorker('backfill-voucher-retry', async () => {
    const r = await retryPendingVoucherGeneration()
    if (r.succeeded || r.failed) {
      logger.info(`[scheduler] 补录凭证自动补齐：成功 ${r.succeeded}、仍失败 ${r.failed}`, r, 'Scheduler')
    }
  }, num('BACKFILL_VOUCHER_RETRY_INTERVAL_MS', 10 * 60 * 1000))

  // 默认小批轮转，错开初次运行；保留时间与历史规则一致。
  const { clearOld: clearOpLogs } = require('./modules/oplogs/oplogs.service')
  startWorker('oplogs-cleanup', () => clearOpLogs({ scheduled: true }),
    num('OPLOGS_CLEAN_INTERVAL_MS', RETENTION_INTERVAL_MS), { initialDelayMs: 30_000, immediate: true })

  startWorker('scan-log-cleanup', () => cleanupRetentionRows(limit => pool.query(
    'DELETE FROM scan_logs WHERE scanned_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY scanned_at LIMIT ?',
    [num('SCAN_LOG_TTL_DAYS', 180), limit],
  )), num('SCAN_LOG_CLEAN_INTERVAL_MS', RETENTION_INTERVAL_MS), { initialDelayMs: 60_000, immediate: true })

  startWorker('inventory-log-cleanup', () => cleanupRetentionRows(limit => pool.query(
    'DELETE FROM inventory_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY created_at LIMIT ?',
    [num('INVENTORY_LOG_TTL_DAYS', 180), limit],
  )), num('INVENTORY_LOG_CLEAN_INTERVAL_MS', RETENTION_INTERVAL_MS), { initialDelayMs: 90_000, immediate: true })

  const eventRetention = [
    'DELETE FROM warehouse_task_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY created_at LIMIT ?',
    'DELETE FROM sale_order_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY created_at LIMIT ?',
    'DELETE FROM inbound_task_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY created_at LIMIT ?',
    'DELETE FROM logistics_tracking_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY created_at LIMIT ?',
  ]
  let nextEventTable = 0
  startWorker('event-log-cleanup', async () => {
    const statement = eventRetention[nextEventTable]
    nextEventTable = (nextEventTable + 1) % eventRetention.length
    await cleanupRetentionRows(limit => pool.query(statement, [num('EVENT_LOG_TTL_DAYS', 180), limit]))
  }, num('EVENT_LOG_CLEAN_INTERVAL_MS', RETENTION_INTERVAL_MS), { initialDelayMs: 120_000, immediate: true })

  // PDA 设备会话 TTL（2026-08-22 扫描）：过期/吊销会话无清理任务，表随设备数缓慢膨胀。
  // 已撤销从撤销时刻、未撤销从过期时刻保留 30 天；未到期的有效会话不清理。
  // 每轮最多 1000 条，不引用会话表不存在的 updated_at，也不以创建/心跳时间代替失效时间。
  startWorker('pda-session-cleanup', async () => {
    await pool.query(
      'DELETE FROM pda_device_sessions WHERE (expires_at < NOW() OR revoked_at IS NOT NULL) AND COALESCE(revoked_at, expires_at) < DATE_SUB(NOW(), INTERVAL 30 DAY) LIMIT 1000',
    )
  }, num('PDA_SESSION_CLEAN_INTERVAL_MS', 24 * 60 * 60 * 1000))

  // refresh token 会话清理（迁移 221，一次性轮换配套）：作废/过期的 jti 记录不再需要，
  // 只保留「已作废且 7 天前」或「已过期且 7 天前」的，避免表随登录次数无界增长。
  // 保留 7 天兜底期：重放攻击的审计与排查需要近期作废记录（refresh 有效期 30 天）。
  startWorker('refresh-session-cleanup', async () => {
    await pool.query(
      'DELETE FROM refresh_token_sessions WHERE (revoked_at IS NOT NULL OR expires_at < NOW()) AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)',
    )
    await cleanupSessionFamilies()
  }, num('REFRESH_SESSION_CLEAN_INTERVAL_MS', 24 * 60 * 60 * 1000))

  // PDA 现场错误扫码/撤销流水清理（2026-08-30 审计）：两表（迁移 293 建表，含 created_at 索引）无 TTL 会随 PDA 作业无界增长。
  // 保留 180 天（与 scan_logs 一致），异常查询只查短期窗口。
  startWorker('pda-anomaly-log-cleanup', async () => {
    for (const t of ['pda_error_logs', 'pda_undo_logs']) {
      await cleanupRetentionRows(limit => pool.query(`DELETE FROM \`${t}\` WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY) ORDER BY created_at LIMIT ?`, [limit]))
    }
  }, num('PDA_ANOMALY_LOG_CLEAN_INTERVAL_MS', 24 * 60 * 60 * 1000))

  // 电子面单（文档 06）：取号 worker + 轨迹 worker，均在事务外做 HTTP。
  // 可用 LOGISTICS_WORKER_ENABLED=0 关闭（如无快递平台对接的部署）。
  if (bool('LOGISTICS_WORKER_ENABLED', true)) {
    startWorker('waybill-fetch', runFetchWaybills, num('LOGISTICS_FETCH_INTERVAL_MS', 10 * 1000))
    startWorker('waybill-track', runTrackWaybills, num('LOGISTICS_TRACK_INTERVAL_MS', 60 * 1000))
    logger.info('[scheduler] 物流取号/轨迹 worker 已启动', {}, 'Scheduler')
  }

  // 循环盘持久化记录每天各仓各类别的结果。进程只在当天全部成功后跳过后续检查。
  const { runAutoCycleScheduling } = require('./modules/stockcheck/stockcheck.cycle')
  let lastCycleDate = ''
  startWorker('stockcheck-cycle', async () => {
    const today = beijingTodayYmd()
    if (lastCycleDate === today) return
    const result = await runAutoCycleScheduling({ plannedDate: today })
    if (!result.failed.length) lastCycleDate = today
    logger.info(`[scheduler] 循环盘自动排程：${result.warehouses} 仓，生成 ${result.created.length} 单，${result.failed.length} 项待重试`, result, 'Scheduler')
  }, num('STOCKCHECK_CYCLE_INTERVAL_MS', 60 * 60 * 1000))
  logger.info('[scheduler] 循环盘自动排程 worker 已启动（默认每小时检查，按业务日记录结果）', {}, 'Scheduler')

  // 钉钉只推作业异常；普通经营计数保留站内。消息带单号/持续时间/处理位置。
  const { sendDingtalkAlert } = require('./utils/dingtalkAlert')
  const { buildOperationAlerts, createOperationAlertWorker } = require('./modules/notifications/operation-alerts.service')
  const { getInboundClosureThresholds } = require('./utils/inboundThresholds')
  const operationAlert = createOperationAlertWorker({
    query: async () => buildOperationAlerts(pool, await getInboundClosureThresholds()),
    send: sendDingtalkAlert,
    publicUrl: () => process.env.APP_PUBLIC_URL,
  })
  startWorker('operation-alert', async () => {
    if (!String(process.env.DINGTALK_ALERT_WEBHOOK || '').trim()) return
    await operationAlert()
  }, num('DINGTALK_ALERT_INTERVAL_MS', 5 * 60 * 1000))
  logger.info('[scheduler] 作业异常预警已启动（5分钟扫描，未配置webhook则跳过）', {}, 'Scheduler')

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
