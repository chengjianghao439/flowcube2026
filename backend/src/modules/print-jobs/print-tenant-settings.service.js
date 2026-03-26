/**
 * 租户打印配额 + 策略配置（DB + 环境变量默认值），带短 TTL 缓存
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getTemplatePayload } = require('./print-policy-templates')

/** 略缩短默认 TTL，管理员调整「并发打印上限」等策略后更快生效（仍可用 PRINT_TENANT_POLICY_CACHE_MS 覆盖） */
const CACHE_MS = Math.min(300_000, Math.max(3_000, Number(process.env.PRINT_TENANT_POLICY_CACHE_MS) || 15_000))
const cache = new Map() // tenantId -> { at, row }

function envNum(key, def) {
  const n = Number(process.env[key])
  return Number.isFinite(n) ? n : def
}

/** 无 DB 行时的全局默认（与 print-policy 环境变量对齐） */
function defaultPolicyFromEnv() {
  return {
    maxQueueJobs: null,
    maxConcurrentPrinting: null,
    monthlyPrintQuota: null,
    policyTemplate: null,
    explorationMode: 'adaptive',
    explorationRateFixed: null,
    explMin: Math.min(1, Math.max(0, envNum('PRINT_EXPLORATION_MIN', 0.06))),
    explMax: Math.min(1, Math.max(0, envNum('PRINT_EXPLORATION_MAX', 0.42))),
    explBase: envNum('PRINT_EXPLORATION_BASE', 0.12),
    explKErr: envNum('PRINT_EXPLORATION_K_ERR', 0.55),
    explKLat: envNum('PRINT_EXPLORATION_K_LAT', 0.35),
    latNormMs: envNum('PRINT_EXPLORATION_LAT_NORM_MS', 60_000),
    wErr: envNum('PRINT_SCORE_W_ERR', 0.42),
    wLat: envNum('PRINT_SCORE_W_LAT', 0.33),
    wHb: envNum('PRINT_SCORE_W_HB', 0.25),
    latScoreScaleMs: envNum('PRINT_SCORE_LAT_SCALE_MS', 45_000),
    coldBonus: envNum('PRINT_SCORE_COLD_BONUS', 0.12),
  }
}

function normTenantId(tenantId) {
  const n = Number(tenantId)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function mergeRow(row) {
  const base = defaultPolicyFromEnv()
  if (!row) return { ...base, raw: null }
  const mode = String(row.exploration_mode || 'adaptive').toLowerCase() === 'fixed' ? 'fixed' : 'adaptive'
  return {
    maxQueueJobs: row.max_queue_jobs != null ? Number(row.max_queue_jobs) : null,
    maxConcurrentPrinting: row.max_concurrent_printing != null ? Number(row.max_concurrent_printing) : null,
    monthlyPrintQuota: row.monthly_print_quota != null ? Number(row.monthly_print_quota) : null,
    policyTemplate: row.policy_template != null ? String(row.policy_template) : null,
    explorationMode: mode,
    explorationRateFixed: row.exploration_rate != null ? Number(row.exploration_rate) : null,
    explMin: row.exploration_min != null ? Number(row.exploration_min) : base.explMin,
    explMax: row.exploration_max != null ? Number(row.exploration_max) : base.explMax,
    explBase: row.exploration_base != null ? Number(row.exploration_base) : base.explBase,
    explKErr: row.exploration_k_err != null ? Number(row.exploration_k_err) : base.explKErr,
    explKLat: row.exploration_k_lat != null ? Number(row.exploration_k_lat) : base.explKLat,
    latNormMs: row.exploration_lat_norm_ms != null ? Number(row.exploration_lat_norm_ms) : base.latNormMs,
    wErr: row.weight_err != null ? Number(row.weight_err) : base.wErr,
    wLat: row.weight_lat != null ? Number(row.weight_lat) : base.wLat,
    wHb: row.weight_hb != null ? Number(row.weight_hb) : base.wHb,
    latScoreScaleMs: row.lat_score_scale_ms != null ? Number(row.lat_score_scale_ms) : base.latScoreScaleMs,
    coldBonus: base.coldBonus,
    raw: row,
  }
}

async function fetchRow(tenantId) {
  const tid = normTenantId(tenantId)
  try {
    const [[row]] = await pool.query('SELECT * FROM print_tenant_settings WHERE tenant_id=?', [tid])
    return row || null
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return null
    throw e
  }
}

/**
 * 合并后的调度策略 + 配额（供 print-dispatch / print-jobs 使用）
 */
async function getTenantPrintPolicy(tenantId) {
  const tid = normTenantId(tenantId)
  const now = Date.now()
  const hit = cache.get(tid)
  if (hit && now - hit.at < CACHE_MS) return hit.policy

  const row = await fetchRow(tid)
  const policy = mergeRow(row)
  cache.set(tid, { at: now, policy })
  return policy
}

function invalidateTenantPolicyCache(tenantId) {
  const tid = normTenantId(tenantId)
  cache.delete(tid)
}

function invalidateAllTenantPolicyCache() {
  cache.clear()
}

/**
 * @param {number} tenantId
 * @param {number} [windowDays=7] 成功率/延迟统计窗口
 */
async function getTenantMetricsSnapshot(tenantId, windowDays = 7) {
  const tid = normTenantId(tenantId)
  const days = Number.isFinite(Number(windowDays)) && Number(windowDays) > 0 ? Number(windowDays) : 7
  const policy = await getTenantPrintPolicy(tid)

  const [[queue]] = await pool.query(
    `SELECT
       SUM(status IN (0,1)) AS queue_len,
       SUM(status=0) AS pending_cnt,
       SUM(status=1) AS printing_cnt
     FROM print_jobs WHERE tenant_id=?`,
    [tid],
  )

  const [[win]] = await pool.query(
    `SELECT
       SUM(status=2) AS done_cnt,
       SUM(status=3) AS fail_cnt,
       AVG(CASE WHEN status=2 AND dispatched_at IS NOT NULL AND acknowledged_at IS NOT NULL
         THEN TIMESTAMPDIFF(MICROSECOND, dispatched_at, acknowledged_at) / 1000 END) AS avg_latency_ms
     FROM print_jobs
     WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [tid, days],
  )

  const done = Number(win?.done_cnt) || 0
  const fail = Number(win?.fail_cnt) || 0
  const finished = done + fail
  const successRate = finished > 0 ? done / finished : null

  return {
    tenantId: tid,
    windowDays: days,
    queueLength: Number(queue?.queue_len) || 0,
    pendingCount: Number(queue?.pending_cnt) || 0,
    printingCount: Number(queue?.printing_cnt) || 0,
    successRate,
    avgLatencyMs:
      win?.avg_latency_ms != null && Number.isFinite(Number(win.avg_latency_ms))
        ? Math.round(Number(win.avg_latency_ms))
        : null,
    doneCount: done,
    failedCount: fail,
    quotas: {
      maxQueueJobs: policy.maxQueueJobs,
      maxConcurrentPrinting: policy.maxConcurrentPrinting,
      monthlyPrintQuota: policy.monthlyPrintQuota,
      policyTemplate: policy.policyTemplate,
      queueUtilization:
        policy.maxQueueJobs != null && policy.maxQueueJobs > 0
          ? (Number(queue?.queue_len) || 0) / policy.maxQueueJobs
          : null,
      concurrentUtilization:
        policy.maxConcurrentPrinting != null && policy.maxConcurrentPrinting > 0
          ? (Number(queue?.printing_cnt) || 0) / policy.maxConcurrentPrinting
          : null,
    },
    policy: {
      explorationMode: policy.explorationMode,
      explorationRate: policy.explorationRateFixed,
      weights: { err: policy.wErr, lat: policy.wLat, hb: policy.wHb },
      latScoreScaleMs: policy.latScoreScaleMs,
      explorationAdaptive: {
        min: policy.explMin,
        max: policy.explMax,
        base: policy.explBase,
        kErr: policy.explKErr,
        kLat: policy.explKLat,
        latNormMs: policy.latNormMs,
      },
    },
  }
}

/** 超级管理员：有任务或有过配置的租户列表 + 指标摘要 */
async function listTenantsOverview(windowDays = 7) {
  const days = Number.isFinite(Number(windowDays)) && Number(windowDays) > 0 ? Number(windowDays) : 7
  const [ids] = await pool.query(
    `SELECT DISTINCT tenant_id AS id FROM (
       SELECT tenant_id FROM print_jobs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       UNION
       SELECT tenant_id FROM print_tenant_settings
     ) t ORDER BY id ASC`,
  )
  const list = []
  for (const { id } of ids) {
    list.push(await getTenantMetricsSnapshot(id, days))
  }
  return list
}

async function getSettingsRow(tenantId) {
  return fetchRow(tenantId)
}

function pick(existing, body, key, dbKey) {
  if (Object.prototype.hasOwnProperty.call(body, key)) return body[key]
  return existing ? existing[dbKey] : null
}

/**
 * @param {object} body — 部分字段即可，未传的列保留库内原值
 */
async function upsertSettings(tenantId, body) {
  const tid = normTenantId(tenantId)
  const ex = await fetchRow(tid)

  const maxQueueJobs = pick(ex, body, 'maxQueueJobs', 'max_queue_jobs')
  const maxConcurrentPrinting = pick(ex, body, 'maxConcurrentPrinting', 'max_concurrent_printing')
  const explorationModeIn = Object.prototype.hasOwnProperty.call(body, 'explorationMode')
    ? body.explorationMode
    : ex?.exploration_mode
  const mode = String(explorationModeIn || 'adaptive').toLowerCase() === 'fixed' ? 'fixed' : 'adaptive'

  const explorationRate = pick(ex, body, 'explorationRate', 'exploration_rate')
  const explorationMin = pick(ex, body, 'explorationMin', 'exploration_min')
  const explorationMax = pick(ex, body, 'explorationMax', 'exploration_max')
  const explorationBase = pick(ex, body, 'explorationBase', 'exploration_base')
  const explorationKErr = pick(ex, body, 'explorationKErr', 'exploration_k_err')
  const explorationKLat = pick(ex, body, 'explorationKLat', 'exploration_k_lat')
  const explorationLatNormMs = pick(ex, body, 'explorationLatNormMs', 'exploration_lat_norm_ms')
  const weightErr = pick(ex, body, 'weightErr', 'weight_err')
  const weightLat = pick(ex, body, 'weightLat', 'weight_lat')
  const weightHb = pick(ex, body, 'weightHb', 'weight_hb')
  const latScoreScaleMs = pick(ex, body, 'latScoreScaleMs', 'lat_score_scale_ms')
  const monthlyPrintQuota = pick(ex, body, 'monthlyPrintQuota', 'monthly_print_quota')
  const policyTemplate = pick(ex, body, 'policyTemplate', 'policy_template')

  await pool.query(
    `INSERT INTO print_tenant_settings (
       tenant_id, max_queue_jobs, max_concurrent_printing, monthly_print_quota,
       exploration_mode, exploration_rate,
       exploration_min, exploration_max, exploration_base,
       exploration_k_err, exploration_k_lat, exploration_lat_norm_ms,
       weight_err, weight_lat, weight_hb, lat_score_scale_ms, policy_template
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       max_queue_jobs = VALUES(max_queue_jobs),
       max_concurrent_printing = VALUES(max_concurrent_printing),
       monthly_print_quota = VALUES(monthly_print_quota),
       exploration_mode = VALUES(exploration_mode),
       exploration_rate = VALUES(exploration_rate),
       exploration_min = VALUES(exploration_min),
       exploration_max = VALUES(exploration_max),
       exploration_base = VALUES(exploration_base),
       exploration_k_err = VALUES(exploration_k_err),
       exploration_k_lat = VALUES(exploration_k_lat),
       exploration_lat_norm_ms = VALUES(exploration_lat_norm_ms),
       weight_err = VALUES(weight_err),
       weight_lat = VALUES(weight_lat),
       weight_hb = VALUES(weight_hb),
       lat_score_scale_ms = VALUES(lat_score_scale_ms),
       policy_template = VALUES(policy_template)`,
    [
      tid,
      maxQueueJobs ?? null,
      maxConcurrentPrinting ?? null,
      monthlyPrintQuota ?? null,
      mode,
      explorationRate ?? null,
      explorationMin ?? null,
      explorationMax ?? null,
      explorationBase ?? null,
      explorationKErr ?? null,
      explorationKLat ?? null,
      explorationLatNormMs ?? null,
      weightErr ?? null,
      weightLat ?? null,
      weightHb ?? null,
      latScoreScaleMs ?? null,
      policyTemplate ?? null,
    ],
  )
  invalidateTenantPolicyCache(tid)
  return fetchRow(tid)
}

/**
 * 应用预设策略模板（覆盖探索与权重相关字段，写入 policy_template）
 */
async function applyPolicyTemplate(tenantId, templateKey) {
  const tid = normTenantId(tenantId)
  const tpl = getTemplatePayload(templateKey)
  if (!tpl) throw new AppError('未知的策略模板', 400)
  const { templateKey: key, explorationMode, ...nums } = tpl
  await upsertSettings(tid, {
    explorationMode,
    explorationMin: nums.explorationMin,
    explorationMax: nums.explorationMax,
    explorationBase: nums.explorationBase,
    explorationKErr: nums.explorationKErr,
    explorationKLat: nums.explorationKLat,
    explorationLatNormMs: nums.explorationLatNormMs,
    weightErr: nums.weightErr,
    weightLat: nums.weightLat,
    weightHb: nums.weightHb,
    latScoreScaleMs: nums.latScoreScaleMs,
    explorationRate: null,
    policyTemplate: key,
  })
  return fetchRow(tid)
}

function formatTenantSettingsApi(row, tenantId) {
  const tid = normTenantId(tenantId)
  if (!row) {
    return {
      tenantId: tid,
      hasDbRow: false,
      maxQueueJobs: null,
      maxConcurrentPrinting: null,
      monthlyPrintQuota: null,
      policyTemplate: null,
      explorationMode: 'adaptive',
      explorationRate: null,
      explorationMin: null,
      explorationMax: null,
      explorationBase: null,
      explorationKErr: null,
      explorationKLat: null,
      explorationLatNormMs: null,
      weightErr: null,
      weightLat: null,
      weightHb: null,
      latScoreScaleMs: null,
    }
  }
  return {
    tenantId: tid,
    hasDbRow: true,
    maxQueueJobs: row.max_queue_jobs != null ? Number(row.max_queue_jobs) : null,
    maxConcurrentPrinting: row.max_concurrent_printing != null ? Number(row.max_concurrent_printing) : null,
    monthlyPrintQuota: row.monthly_print_quota != null ? Number(row.monthly_print_quota) : null,
    policyTemplate: row.policy_template != null ? String(row.policy_template) : null,
    explorationMode: String(row.exploration_mode || 'adaptive'),
    explorationRate: row.exploration_rate != null ? Number(row.exploration_rate) : null,
    explorationMin: row.exploration_min != null ? Number(row.exploration_min) : null,
    explorationMax: row.exploration_max != null ? Number(row.exploration_max) : null,
    explorationBase: row.exploration_base != null ? Number(row.exploration_base) : null,
    explorationKErr: row.exploration_k_err != null ? Number(row.exploration_k_err) : null,
    explorationKLat: row.exploration_k_lat != null ? Number(row.exploration_k_lat) : null,
    explorationLatNormMs: row.exploration_lat_norm_ms != null ? Number(row.exploration_lat_norm_ms) : null,
    weightErr: row.weight_err != null ? Number(row.weight_err) : null,
    weightLat: row.weight_lat != null ? Number(row.weight_lat) : null,
    weightHb: row.weight_hb != null ? Number(row.weight_hb) : null,
    latScoreScaleMs: row.lat_score_scale_ms != null ? Number(row.lat_score_scale_ms) : null,
    updatedAt: row.updated_at ?? null,
  }
}

module.exports = {
  getTenantPrintPolicy,
  invalidateTenantPolicyCache,
  invalidateAllTenantPolicyCache,
  getTenantMetricsSnapshot,
  listTenantsOverview,
  getSettingsRow,
  upsertSettings,
  applyPolicyTemplate,
  defaultPolicyFromEnv,
  mergeRow,
  formatTenantSettingsApi,
}
