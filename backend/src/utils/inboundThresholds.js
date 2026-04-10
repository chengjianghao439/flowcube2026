const { pool } = require('../config/db')

const DEFAULTS = {
  printTimeoutMinutes: 10,
  putawayTimeoutHours: 24,
  auditTimeoutHours: 24,
}

let cached = null
let cacheAt = 0
const CACHE_TTL_MS = 30 * 1000

function normalizePositiveNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : fallback
}

async function readThresholdsFromDb() {
  const [rows] = await pool.query(
    `SELECT key_name, value
     FROM sys_settings
     WHERE key_name IN ('inbound_print_timeout_minutes', 'inbound_putaway_timeout_hours', 'inbound_audit_timeout_hours')`,
  )
  const map = new Map(rows.map(row => [String(row.key_name), row.value]))
  return {
    printTimeoutMinutes: normalizePositiveNumber(map.get('inbound_print_timeout_minutes'), DEFAULTS.printTimeoutMinutes),
    putawayTimeoutHours: normalizePositiveNumber(map.get('inbound_putaway_timeout_hours'), DEFAULTS.putawayTimeoutHours),
    auditTimeoutHours: normalizePositiveNumber(map.get('inbound_audit_timeout_hours'), DEFAULTS.auditTimeoutHours),
  }
}

async function getInboundClosureThresholds({ force = false } = {}) {
  if (!force && cached && (Date.now() - cacheAt) < CACHE_TTL_MS) return cached
  try {
    cached = await readThresholdsFromDb()
  } catch {
    cached = { ...DEFAULTS }
  }
  cacheAt = Date.now()
  return cached
}

module.exports = {
  DEFAULT_INBOUND_THRESHOLDS: DEFAULTS,
  getInboundClosureThresholds,
}
