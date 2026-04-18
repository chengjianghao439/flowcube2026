const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { resolvePrinterForJob, normalizeJobType } = require('./print-dispatch')
const { recordPrintSuccess, recordPrintFailure } = require('./printer-health')
const { appendInboundPrintEventByJob } = require('./print-jobs.helpers')
const { findById } = require('./print-jobs.query')
const {
  STATUS,
  MAX_RETRY,
  ttlMinutes,
  parsePriority,
  assertCanComplete,
  assertCanCompleteLocalDesktop,
  nextFailState,
} = require('./print-jobs.status')
const { pushToClients } = require('./print-jobs.dispatch')

async function create({
  printerId,
  warehouseId: warehouseIdIn,
  jobType: jobTypeIn,
  priority: priorityIn,
  jobUniqueKey: jobUniqueKeyRaw,
  dispatchReason: dispatchReasonIn,
  refType: refTypeIn,
  refId: refIdIn,
  refCode: refCodeIn,
  templateId,
  title,
  contentType = 'html',
  content,
  copies = 1,
  createdBy,
}) {
  if (!content) throw new AppError('打印内容不能为空', 400)
  if (!title) throw new AppError('任务标题不能为空', 400)

  const jobUniqueKey = jobUniqueKeyRaw != null ? String(jobUniqueKeyRaw).trim() || null : null
  if (jobUniqueKey && jobUniqueKey.length > 160) {
    throw new AppError('jobUniqueKey 长度不能超过 160', 400)
  }

  const priority = parsePriority(priorityIn)
  const jobTypeNorm = normalizeJobType(jobTypeIn, contentType)
  const refType = refTypeIn != null ? String(refTypeIn).trim() || null : null
  const refId = refIdIn != null && refIdIn !== '' && Number.isFinite(Number(refIdIn)) ? Number(refIdIn) : null
  const refCode = refCodeIn != null ? String(refCodeIn).trim() || null : null
  const warehouseId =
    warehouseIdIn != null && warehouseIdIn !== '' && Number.isFinite(Number(warehouseIdIn))
      ? Number(warehouseIdIn)
      : null

  if (jobUniqueKey) {
    const [[dup]] = await pool.query(
      `SELECT id FROM print_jobs
       WHERE job_unique_key=? AND status IN (?,?,?)
         AND (warehouse_id <=> ?) AND (job_type <=> ?)
       ORDER BY id DESC LIMIT 1`,
      [jobUniqueKey, STATUS.PENDING, STATUS.PRINTING, STATUS.DONE, warehouseId, jobTypeNorm],
    )
    if (dup && dup.id != null) return findById(Number(dup.id))
  }

  const explicitPrinter =
    printerId != null &&
    printerId !== '' &&
    Number.isFinite(Number(printerId)) &&
    Number(printerId) > 0

  let resolvedId = explicitPrinter ? Number(printerId) : null
  let dispatchReason = 'explicit'

  if (!explicitPrinter) {
    const r = await resolvePrinterForJob({
      warehouseId: warehouseId ?? undefined,
      jobType: jobTypeNorm,
      contentType,
    })
    resolvedId = r.printerId
    dispatchReason = r.dispatchReason || 'fallback'
  }
  if (dispatchReasonIn) dispatchReason = String(dispatchReasonIn)

  if (!resolvedId) {
    throw new AppError('无法分配打印机：请指定 printerId，或传入 warehouseId 并配置打印机用途绑定', 400)
  }

  const [[printer]] = await pool.query('SELECT id, code, status FROM printers WHERE id=?', [resolvedId])
  if (!printer) throw new AppError('打印机不存在', 400)

  const ttl = ttlMinutes()
  const [r] = await pool.query(
    `INSERT INTO print_jobs (printer_id, template_id, title, content_type, content, copies, priority, job_type, warehouse_id, job_unique_key, dispatch_reason, ref_type, ref_id, ref_code, created_by, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [
      resolvedId,
      templateId || null,
      title,
      contentType,
      content,
      copies,
      priority,
      jobTypeNorm,
      warehouseId,
      jobUniqueKey,
      dispatchReason,
      refType,
      refId,
      refCode,
      createdBy || null,
      ttl,
    ],
  )
  const insertId = r.insertId != null ? Number(r.insertId) : NaN
  if (!Number.isFinite(insertId) || insertId <= 0) {
    throw new AppError('创建打印任务失败（无法解析任务 ID）', 500)
  }
  const job = await findById(insertId)

  try {
    await pushToClients(printer.code, job)
  } catch (e) {
    logger.error(
      `[print-jobs] pushToClients 失败（任务已入库 id=${insertId}）`,
      e instanceof Error ? e : new Error(String(e)),
      { printerCode: printer.code },
      'PrintJobs',
    )
  }

  return findById(insertId)
}

async function complete(id, { ackToken } = {}) {
  const job = await findById(id)
  assertCanComplete(job)
  if (job.status === STATUS.DONE) return job
  const [[sec]] = await pool.query('SELECT ack_token FROM print_jobs WHERE id=?', [id])
  if (sec?.ack_token) {
    const t = String(ackToken || '').trim()
    if (!t || t !== sec.ack_token) {
      throw new AppError('打印确认令牌无效或缺失', 400)
    }
  }
  const [[latRow]] = await pool.query(
    `SELECT printer_id,
            TIMESTAMPDIFF(MICROSECOND, dispatched_at, NOW()) / 1000 AS latency_ms
     FROM print_jobs WHERE id=? AND dispatched_at IS NOT NULL`,
    [id],
  )
  const latencyMs =
    latRow && latRow.latency_ms != null && Number(latRow.latency_ms) > 0
      ? Number(latRow.latency_ms)
      : null

  await pool.query(
    'UPDATE print_jobs SET status=?, error_message=NULL, ack_token=NULL, acknowledged_at=NOW() WHERE id=?',
    [STATUS.DONE, id],
  )
  await appendInboundPrintEventByJob(
    job,
    'print_completed',
    '库存条码打印成功',
    job.refCode ? `库存条码 ${job.refCode} 已打印` : '库存条码已打印',
    { printJobId: job.id, barcode: job.refCode || null },
  ).catch(() => {})
  if (latRow?.printer_id && latencyMs != null) {
    await recordPrintSuccess(latRow.printer_id, latencyMs).catch(() => {})
  }
  return findById(id)
}

async function completeLocalDesktop(id) {
  const job = await findById(id)
  if (job.status === STATUS.DONE) return job
  const [[sec]] = await pool.query('SELECT ack_token FROM print_jobs WHERE id=?', [id])
  assertCanCompleteLocalDesktop(job, !!sec?.ack_token)
  const [ur] = await pool.query(
    'UPDATE print_jobs SET status=?, error_message=NULL, ack_token=NULL, acknowledged_at=NOW() WHERE id=? AND status=?',
    [STATUS.DONE, id, STATUS.PENDING],
  )
  if (!ur.affectedRows) {
    throw new AppError('任务状态已变更，请刷新后重试', 409)
  }
  await appendInboundPrintEventByJob(
    job,
    'print_completed',
    '库存条码打印成功',
    job.refCode ? `库存条码 ${job.refCode} 已打印` : '库存条码已打印',
    { printJobId: job.id, barcode: job.refCode || null },
  ).catch(() => {})
  return findById(id)
}

async function fail(id, errorMessage) {
  const job = await findById(id)
  const next = nextFailState(job)
  if (next.done) return job

  await recordPrintFailure(job.printerId).catch(() => {})

  const msg = errorMessage || '未知错误'
  if (next.status === STATUS.PENDING) {
    await pool.query(
      'UPDATE print_jobs SET status=?, retry_count=?, error_message=?, ack_token=NULL, dispatched_at=NULL, expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?',
      [next.status, next.retryCount, msg, ttlMinutes(), id],
    )
  } else {
    await pool.query(
      'UPDATE print_jobs SET status=?, retry_count=?, error_message=?, ack_token=NULL, dispatched_at=NULL WHERE id=?',
      [next.status, next.retryCount, msg, id],
    )
  }
  if (next.status === STATUS.PENDING) {
    const updated = await findById(id)
    const [[printer]] = await pool.query('SELECT code FROM printers WHERE id=?', [job.printerId])
    if (printer) await pushToClients(printer.code, updated)
  }
  await appendInboundPrintEventByJob(
    job,
    next.status === STATUS.FAILED ? 'print_failed' : 'print_retrying',
    next.status === STATUS.FAILED ? '库存条码打印失败' : '库存条码打印重试',
    msg,
    { printJobId: job.id, barcode: job.refCode || null, retryCount: next.retryCount },
  ).catch(() => {})
  return findById(id)
}

async function retry(id) {
  const job = await findById(id)
  await pool.query(
    'UPDATE print_jobs SET status=0, retry_count=0, error_message=NULL, ack_token=NULL, dispatched_at=NULL, expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?',
    [ttlMinutes(), id],
  )
  const updated = await findById(id)
  const [[printer]] = await pool.query('SELECT code FROM printers WHERE id=?', [job.printerId])
  if (printer) await pushToClients(printer.code, updated)
  return updated
}

module.exports = {
  create,
  complete,
  completeLocalDesktop,
  fail,
  retry,
  normalizeJobType,
  resolvePrinterForJob,
  STATUS,
  MAX_RETRY,
}
