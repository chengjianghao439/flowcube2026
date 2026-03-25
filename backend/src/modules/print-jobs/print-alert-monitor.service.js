/**
 * 打印运营告警：成功率偏低、队列积压、打印机健康恶化
 */
const { pool } = require('../../config/db')
const logger = require('../../utils/logger')

const STATUS = { PENDING: 0, PRINTING: 1, DONE: 2, FAILED: 3 }

const DEBOUNCE_HOURS = Math.min(24, Math.max(1, Number(process.env.PRINT_ALERT_DEBOUNCE_HOURS) || 2))
const SUCCESS_MIN = Math.min(1, Math.max(0.5, Number(process.env.PRINT_ALERT_SUCCESS_RATE_MIN) || 0.82))
const BACKLOG_MIN = Math.max(5, Number(process.env.PRINT_ALERT_QUEUE_MIN) || 30)
const BACKLOG_RATIO = Math.min(1, Math.max(0.5, Number(process.env.PRINT_ALERT_QUEUE_RATIO) || 0.85))
const PRINTER_ERR_THRESHOLD = Math.min(1, Math.max(0.3, Number(process.env.PRINT_ALERT_PRINTER_ERR) || 0.45))

async function recentOpenAlert(tenantId, alertType) {
  const [[row]] = await pool.query(
    `SELECT id FROM print_alert_events
     WHERE tenant_id=? AND alert_type=? AND acknowledged_at IS NULL
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
     ORDER BY id DESC LIMIT 1`,
    [tenantId, alertType, DEBOUNCE_HOURS],
  )
  return row?.id ?? null
}

async function insertAlert(tenantId, alertType, severity, title, message, context = null) {
  if (await recentOpenAlert(tenantId, alertType)) return
  await pool.query(
    `INSERT INTO print_alert_events (tenant_id, alert_type, severity, title, message, context_json)
     VALUES (?,?,?,?,?,?)`,
    [tenantId, alertType, severity, title, message, context ? JSON.stringify(context) : null],
  )
}

async function tenantIdsToScan() {
  const [rows] = await pool.query(
    `SELECT DISTINCT tenant_id AS id FROM (
       SELECT tenant_id FROM print_jobs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
       UNION SELECT tenant_id FROM print_tenant_settings
       UNION SELECT tenant_id FROM print_tenant_billing_monthly WHERE year_month = DATE_FORMAT(NOW(), '%Y-%m')
     ) x`,
  )
  return rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n >= 0)
}

async function checkTenantSuccessRate(tenantId) {
  const [[day]] = await pool.query(
    `SELECT
       SUM(status=2) AS okc,
       SUM(status=3) AS failc
     FROM print_jobs
     WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [tenantId],
  )
  const ok = Number(day?.okc) || 0
  const fail = Number(day?.failc) || 0
  const total = ok + fail
  if (total < 8) return
  const rate = ok / total
  if (rate < SUCCESS_MIN) {
    await insertAlert(
      tenantId,
      'success_rate_low',
      'warning',
      '打印成功率偏低',
      `近 24 小时成功率 ${(rate * 100).toFixed(1)}%，低于阈值 ${(SUCCESS_MIN * 100).toFixed(0)}%`,
      { rate, sampleTotal: total, windowHours: 24 },
    )
  }
}

async function checkTenantQueueBacklog(tenantId) {
  const [[q]] = await pool.query(
    `SELECT COUNT(*) AS c FROM print_jobs WHERE tenant_id=? AND status IN (?,?)`,
    [tenantId, STATUS.PENDING, STATUS.PRINTING],
  )
  const depth = Number(q?.c) || 0
  const [[set]] = await pool.query(
    'SELECT max_queue_jobs FROM print_tenant_settings WHERE tenant_id=?',
    [tenantId],
  )
  const maxQ = set?.max_queue_jobs != null ? Number(set.max_queue_jobs) : null
  const threshold = maxQ != null ? Math.max(5, Math.floor(maxQ * BACKLOG_RATIO)) : BACKLOG_MIN
  if (depth >= threshold) {
    const severity = maxQ != null && depth >= maxQ ? 'critical' : 'warning'
    await insertAlert(
      tenantId,
      'queue_backlog',
      severity,
      '打印队列积压',
      `当前排队/打印中共 ${depth} 单${maxQ != null ? `，接近上限 ${maxQ}` : ''}`,
      { depth, maxQueueJobs: maxQ, threshold },
    )
  }
}

async function checkTenantPrinterHealth(tenantId) {
  const [rows] = await pool.query(
    `SELECT h.printer_id, h.error_rate, p.code
     FROM printer_health_stats h
     LEFT JOIN printers p ON p.id = h.printer_id
     WHERE h.tenant_id=? AND h.error_rate >= ?`,
    [tenantId, PRINTER_ERR_THRESHOLD],
  )
  for (const r of rows) {
    const pid = Number(r.printer_id)
    const code = r.code || String(pid)
    await insertAlert(
      tenantId,
      'printer_degraded',
      'warning',
      '打印机异常率偏高',
      `打印机 ${code} 错误率 ${(Number(r.error_rate) * 100).toFixed(1)}%`,
      { printerId: pid, printerCode: code, errorRate: Number(r.error_rate) },
    )
  }
}

async function runPrintAlertChecks() {
  const tenants = await tenantIdsToScan()
  for (const tid of tenants) {
    try {
      await checkTenantSuccessRate(tid)
      await checkTenantQueueBacklog(tid)
      await checkTenantPrinterHealth(tid)
    } catch (e) {
      logger.warn(`[print-alerts] tenant ${tid} ${e.message}`, {}, 'PrintAlerts')
    }
  }
}

async function listAlerts(tenantId, { limit = 50, unackOnly = false } = {}) {
  const tid = Number(tenantId) >= 0 ? Number(tenantId) : 0
  const lim = Math.min(200, Math.max(1, Number(limit) || 50))
  const unack = unackOnly ? ' AND acknowledged_at IS NULL' : ''
  const [rows] = await pool.query(
    `SELECT id, tenant_id, alert_type, severity, title, message, context_json, created_at, acknowledged_at, acknowledged_by
     FROM print_alert_events
     WHERE tenant_id=?${unack}
     ORDER BY id DESC
     LIMIT ?`,
    [tid, lim],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    tenantId: Number(r.tenant_id),
    alertType: r.alert_type,
    severity: r.severity,
    title: r.title,
    message: r.message,
    context: r.context_json,
    createdAt: r.created_at,
    acknowledgedAt: r.acknowledged_at,
    acknowledgedBy: r.acknowledged_by,
  }))
}

async function acknowledgeAlert(alertId, userId, requestTenantId, isAdmin) {
  const id = Number(alertId)
  if (!Number.isFinite(id) || id <= 0) return false
  const [[row]] = await pool.query('SELECT tenant_id FROM print_alert_events WHERE id=?', [id])
  if (!row) return null
  if (!isAdmin && Number(row.tenant_id) !== Number(requestTenantId)) return false
  const [r] = await pool.query(
    'UPDATE print_alert_events SET acknowledged_at=NOW(), acknowledged_by=? WHERE id=? AND acknowledged_at IS NULL',
    [userId, id],
  )
  return (r.affectedRows ?? 0) > 0
}

module.exports = { runPrintAlertChecks, insertAlert, listAlerts, acknowledgeAlert }
