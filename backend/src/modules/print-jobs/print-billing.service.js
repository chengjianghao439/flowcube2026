/**
 * 租户打印计费：月度成功印量统计 + 配额用量快照（429 详情）
 */
const { pool } = require('../../config/db')

const STATUS = { PENDING: 0, PRINTING: 1, DONE: 2, FAILED: 3 }

function normTenantId(tenantId) {
  const n = Number(tenantId)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function currentYearMonth(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * 成功完成一单时累加月度统计（按 copies）
 */
async function recordSuccessfulPrint(tenantId, copies = 1) {
  const tid = normTenantId(tenantId)
  const ym = currentYearMonth()
  const c = Math.max(1, Number(copies) || 1)
  await pool.query(
    `INSERT INTO print_tenant_billing_monthly (tenant_id, year_month, job_count, copy_count)
     VALUES (?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       job_count = job_count + 1,
       copy_count = copy_count + VALUES(copy_count)`,
    [tid, ym, c],
  )
}

/** 本月已成功完成的份数（与 billing 表一致，可回填） */
async function getCompletedCopiesThisMonth(tenantId) {
  const tid = normTenantId(tenantId)
  const ym = currentYearMonth()
  const [[row]] = await pool.query(
    'SELECT copy_count FROM print_tenant_billing_monthly WHERE tenant_id=? AND year_month=?',
    [tid, ym],
  )
  if (row) return Number(row.copy_count) || 0
  const [[agg]] = await pool.query(
    `SELECT COALESCE(SUM(copies), 0) AS c FROM print_jobs
     WHERE tenant_id=? AND status=? AND acknowledged_at IS NOT NULL
       AND acknowledged_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    [tid, STATUS.DONE],
  )
  return Number(agg?.c) || 0
}

/** 本月创建且仍在排队/打印中的份数（占用月度额度） */
async function getPipelineCopiesThisMonth(tenantId) {
  const tid = normTenantId(tenantId)
  const [[agg]] = await pool.query(
    `SELECT COALESCE(SUM(copies), 0) AS c FROM print_jobs
     WHERE tenant_id=? AND status IN (?,?)
       AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    [tid, STATUS.PENDING, STATUS.PRINTING],
  )
  return Number(agg?.c) || 0
}

async function getQueueDepth(tenantId) {
  const tid = normTenantId(tenantId)
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS c FROM print_jobs WHERE tenant_id=? AND status IN (?,?)',
    [tid, STATUS.PENDING, STATUS.PRINTING],
  )
  return Number(row?.c) || 0
}

/**
 * 供创建任务前校验与 429 响应
 * @param {number} tenantId
 * @param {number} [additionalCopies=1] 即将入队的份数
 * @param {{ maxQueueJobs: number|null, monthlyPrintQuota: number|null }} policy
 */
async function getQuotaUsageSnapshot(tenantId, additionalCopies = 1, policy = {}) {
  const tid = normTenantId(tenantId)
  const add = Math.max(1, Number(additionalCopies) || 1)
  const queueCurrent = await getQueueDepth(tid)
  const queueLimit = policy.maxQueueJobs != null ? Number(policy.maxQueueJobs) : null
  const queueRemaining = queueLimit != null ? Math.max(0, queueLimit - queueCurrent) : null

  const monthlyPrinted = await getCompletedCopiesThisMonth(tid)
  const pipelineCopies = await getPipelineCopiesThisMonth(tid)
  const monthlyQuota = policy.monthlyPrintQuota != null ? Number(policy.monthlyPrintQuota) : null
  const monthlyCommitted = monthlyPrinted + pipelineCopies
  const monthlyAfterNew = monthlyCommitted + add
  const monthlyRemaining =
    monthlyQuota != null ? Math.max(0, monthlyQuota - monthlyCommitted) : null

  return {
    tenantId: tid,
    yearMonth: currentYearMonth(),
    queue: {
      current: queueCurrent,
      limit: queueLimit,
      remaining: queueRemaining,
    },
    monthly: {
      printedCopies: monthlyPrinted,
      pipelineCopies,
      committedCopies: monthlyCommitted,
      quota: monthlyQuota,
      remaining: monthlyRemaining,
      afterNewJobCopies: monthlyAfterNew,
    },
  }
}

/**
 * 历史月度账单（不含当月可再调 getTenantMetricsSnapshot）
 */
async function listMonthlyBilling(tenantId, limitMonths = 12) {
  const tid = normTenantId(tenantId)
  const lim = Math.min(60, Math.max(1, Number(limitMonths) || 12))
  const [rows] = await pool.query(
    `SELECT year_month, job_count, copy_count, updated_at
     FROM print_tenant_billing_monthly
     WHERE tenant_id=?
     ORDER BY year_month DESC
     LIMIT ?`,
    [tid, lim],
  )
  return rows.map((r) => ({
    yearMonth: r.year_month,
    jobCount: Number(r.job_count),
    copyCount: Number(r.copy_count),
    updatedAt: r.updated_at,
  }))
}

module.exports = {
  recordSuccessfulPrint,
  getCompletedCopiesThisMonth,
  getPipelineCopiesThisMonth,
  getQuotaUsageSnapshot,
  listMonthlyBilling,
  currentYearMonth,
}
