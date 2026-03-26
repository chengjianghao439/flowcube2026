/**
 * 打印机健康度：基于完成/失败回调做 EWMA，供调度排序参考。
 */
const { pool } = require('../../config/db')

const LAT_ALPHA = Number(process.env.PRINTER_HEALTH_LAT_ALPHA) || 0.25
const ERR_FAIL_WEIGHT = Number(process.env.PRINTER_HEALTH_ERR_FAIL) || 0.35
const ERR_DECAY = Number(process.env.PRINTER_HEALTH_ERR_DECAY) || 0.65
const OK_DECAY = Number(process.env.PRINTER_HEALTH_OK_DECAY) || 0.9

/** 前 N 个样本视为冷启动：调度时在同负载下优先探测 */
const COLD_START_MAX_SAMPLES = Number(process.env.PRINTER_HEALTH_COLD_START_MAX) || 10

/** 无记录时的默认分（与「零样本」一致，由 cold 标记优先） */
const DEFAULT_ERROR_RATE = Number(process.env.PRINTER_HEALTH_DEFAULT_ERROR_RATE) || 0
const DEFAULT_LATENCY_MS = Number(process.env.PRINTER_HEALTH_DEFAULT_LATENCY_MS) || 0

function coldEntry() {
  return {
    error_rate: DEFAULT_ERROR_RATE,
    avg_latency_ms: DEFAULT_LATENCY_MS,
    sample_count: 0,
    coldStart: true,
  }
}

function isCold(h) {
  return (h.sample_count ?? 0) < COLD_START_MAX_SAMPLES
}

function normTenant(tenantId) {
  const n = Number(tenantId)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

async function recordPrintSuccess(printerId, latencyMs, tenantId = 0) {
  const pid = Number(printerId)
  if (!Number.isFinite(pid) || pid <= 0) return
  const tid = normTenant(tenantId)
  const lat = Number(latencyMs)
  const useLat = Number.isFinite(lat) && lat > 0 && lat < 3_600_000

  const [[row]] = await pool.query(
    'SELECT error_rate, avg_latency_ms, sample_count FROM printer_health_stats WHERE tenant_id=? AND printer_id=?',
    [tid, pid],
  )
  let er = row ? Number(row.error_rate) : 0
  let al = row ? Number(row.avg_latency_ms) : 0
  const sc = row ? Number(row.sample_count) : 0
  er = Math.max(0, Math.min(1, er * OK_DECAY))
  if (useLat) {
    al = Math.round(LAT_ALPHA * lat + (1 - LAT_ALPHA) * al)
  }
  await pool.query(
    `INSERT INTO printer_health_stats (tenant_id, printer_id, error_rate, avg_latency_ms, sample_count)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       error_rate = VALUES(error_rate),
       avg_latency_ms = VALUES(avg_latency_ms),
       sample_count = VALUES(sample_count)`,
    [tid, pid, er, al, sc + 1],
  )
}

async function recordPrintFailure(printerId, tenantId = 0) {
  const pid = Number(printerId)
  if (!Number.isFinite(pid) || pid <= 0) return
  const tid = normTenant(tenantId)
  const [[row]] = await pool.query(
    'SELECT error_rate, avg_latency_ms, sample_count FROM printer_health_stats WHERE tenant_id=? AND printer_id=?',
    [tid, pid],
  )
  let er = row ? Number(row.error_rate) : 0
  const al = row ? Number(row.avg_latency_ms) : 0
  const sc = row ? Number(row.sample_count) : 0
  er = Math.min(1, ERR_FAIL_WEIGHT + ERR_DECAY * er)
  await pool.query(
    `INSERT INTO printer_health_stats (tenant_id, printer_id, error_rate, avg_latency_ms, sample_count)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       error_rate = VALUES(error_rate),
       avg_latency_ms = VALUES(avg_latency_ms),
       sample_count = VALUES(sample_count)`,
    [tid, pid, er, al, sc + 1],
  )
}

async function getHealthMap(tenantId, printerIds) {
  const tid = normTenant(tenantId)
  const ids = [...new Set(printerIds.map(Number).filter((n) => n > 0))]
  if (!ids.length) return new Map()
  let rows = []
  try {
    ;[rows] = await pool.query(
      `SELECT printer_id, error_rate, avg_latency_ms, sample_count FROM printer_health_stats
       WHERE tenant_id=? AND printer_id IN (${ids.map(() => '?').join(',')})`,
      [tid, ...ids],
    )
  } catch (e) {
    // 未执行 045/047 等迁移时表结构不一致，退化为无历史健康度
    if (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE') {
      return new Map(ids.map((id) => [id, coldEntry()]))
    }
    throw e
  }
  const fromDb = new Map(
    rows.map((r) => {
      const sc = Number(r.sample_count) || 0
      return [
        Number(r.printer_id),
        {
          error_rate: Number(r.error_rate) || 0,
          avg_latency_ms: Number(r.avg_latency_ms) || 0,
          sample_count: sc,
          coldStart: sc < COLD_START_MAX_SAMPLES,
        },
      ]
    }),
  )
  const m = new Map()
  for (const id of ids) {
    m.set(id, fromDb.get(id) ?? coldEntry())
  }
  return m
}

module.exports = {
  recordPrintSuccess,
  recordPrintFailure,
  getHealthMap,
  coldEntry,
  isCold,
  COLD_START_MAX_SAMPLES,
}
