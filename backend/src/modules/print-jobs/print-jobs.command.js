const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { resolvePrinterForJob, normalizeJobType } = require('./print-dispatch')
const { recordPrintSuccess, recordPrintFailure } = require('./printer-health')
const { appendInboundPrintEventByJob } = require('./print-jobs.helpers')
const { findById, findByIdWithExecutor } = require('./print-jobs.query')
const {
  STATUS,
  MAX_RETRY,
  ttlMinutes,
  parsePriority,
  assertCanCompleteLocalDesktop,
} = require('./print-jobs.status')

async function findExistingActiveJob(exec, { jobUniqueKey, warehouseId, jobType }) {
  if (!jobUniqueKey) return null
  const [[dup]] = await exec.query(
    `SELECT id FROM print_jobs
     WHERE job_unique_key=? AND status IN (?,?,?)
       AND (warehouse_id <=> ?) AND (job_type <=> ?)
     ORDER BY id DESC LIMIT 1`,
    [jobUniqueKey, STATUS.PENDING, STATUS.PRINTING, STATUS.DONE, warehouseId, jobType],
  )
  if (!dup?.id) return null
  return findByIdWithExecutor(exec, Number(dup.id))
}

async function printOptionalSideEffect(sideEffectName, promise, meta = {}) {
  try {
    return await promise
  } catch (e) {
    logger.warn(
      '打印任务非阻断副作用失败，主打印状态已按主链推进',
      {
        sideEffectName,
        degradation: 'print_side_effect_failed',
        error: e?.message || String(e),
        ...meta,
      },
      'PrintJobs',
    )
    return null
  }
}

async function createRecord(exec, {
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
  reloadAfterCreate = false,
}) {
  if (!content) throw new AppError('打印内容不能为空', 400, 'PRINT_CONTENT_REQUIRED')
  if (!title) throw new AppError('任务标题不能为空', 400, 'PRINT_TITLE_REQUIRED')

  const jobUniqueKey = jobUniqueKeyRaw != null ? String(jobUniqueKeyRaw).trim() || null : null
  if (jobUniqueKey && jobUniqueKey.length > 160) {
    throw new AppError('jobUniqueKey 长度不能超过 160', 400, 'PRINT_JOB_UNIQUE_KEY_TOO_LONG')
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
    const existing = await findExistingActiveJob(exec, {
      jobUniqueKey,
      warehouseId,
      jobType: jobTypeNorm,
    })
    if (existing) return existing
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
    throw new AppError('无法分配打印机：请指定 printerId，或传入 warehouseId 并配置打印机用途绑定', 400, 'PRINT_PRINTER_ASSIGNMENT_REQUIRED')
  }

  const [[printer]] = await exec.query('SELECT id, code, status FROM printers WHERE id=?', [resolvedId])
  if (!printer) throw new AppError('打印机不存在', 404, 'PRINT_PRINTER_NOT_FOUND')

  const ttl = ttlMinutes()
  let r
  try {
    ;[r] = await exec.query(
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
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY' && jobUniqueKey) {
      const existing = await findExistingActiveJob(exec, {
        jobUniqueKey,
        warehouseId,
        jobType: jobTypeNorm,
      })
      if (existing) return existing
      throw new AppError('打印任务幂等冲突，请刷新后重试', 409, 'IDEMPOTENCY_CONFLICT')
    }
    throw err
  }
  const insertId = r.insertId != null ? Number(r.insertId) : NaN
  if (!Number.isFinite(insertId) || insertId <= 0) {
    throw new AppError('创建打印任务失败（无法解析任务 ID）', 500, 'PRINT_JOB_CREATE_FAILED')
  }
  const job = await findByIdWithExecutor(exec, insertId)

  return reloadAfterCreate ? findById(insertId) : job
}

async function create(args) {
  return createRecord(pool, {
    ...args,
    reloadAfterCreate: true,
  })
}

async function createWithinTransaction(conn, args) {
  return createRecord(conn, {
    ...args,
    reloadAfterCreate: false,
  })
}

async function assertQueueReady({
  warehouseId,
  jobType,
  contentType = 'zpl',
  requireClientOnline = true,
}) {
  const requiresExactBinding = String(jobType || '').trim().toLowerCase() === 'package_label'
  const resolved = await resolvePrinterForJob({
    warehouseId,
    jobType,
    contentType,
    requireBinding: requiresExactBinding,
    allowBindingFallback: !requiresExactBinding,
  })
  if (!resolved?.printerId) {
    throw new AppError('未找到可用打印机，请先在打印机管理中绑定对应用途', 409, 'PRINT_BINDING_MISSING')
  }

  const [[printer]] = await pool.query(
    `SELECT
        p.id,
        p.name,
        p.code,
        p.status,
        p.client_id,
        pc.status AS client_status,
        pc.last_seen,
        TIMESTAMPDIFF(SECOND, pc.last_seen, NOW()) AS seconds_since_seen
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     WHERE p.id = ?`,
    [resolved.printerId],
  )
  if (!printer || Number(printer.status) !== 1) {
    throw new AppError('打印机未启用，请先检查打印机状态', 409, 'PRINT_PRINTER_DISABLED')
  }
  if (requireClientOnline && !printer.client_id) {
    throw new AppError('打印机未绑定桌面客户端，请先在打印机管理中从本机添加并绑定用途', 409, 'PRINT_CLIENT_NOT_BOUND')
  }

  const secondsSinceSeen = Number(printer.seconds_since_seen)
  const clientOnline =
    Number(printer.client_status) === 1
    && Number.isFinite(secondsSinceSeen)
    && secondsSinceSeen >= 0
    && secondsSinceSeen <= 30

  if (requireClientOnline && !clientOnline) {
    throw new AppError('打印客户端离线，请在连接打印机的 极序 Flow 桌面端重新上线后再继续', 409, 'PRINT_CLIENT_OFFLINE')
  }

  return {
    printerId: Number(printer.id),
    printerCode: printer.code,
    printerName: printer.name,
    clientId: printer.client_id,
    clientOnline,
    clientLastSeen: printer.last_seen,
  }
}

async function complete(id, { ackToken } = {}) {
  const job = await findById(id)
  const token = String(ackToken || '').trim()
  if (!token) {
    throw new AppError('打印确认令牌无效或缺失', 400, 'PRINT_ACK_TOKEN_INVALID')
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

  const [ur] = await pool.query(
    `UPDATE print_jobs
     SET status=?, error_message=NULL, ack_token=NULL, acknowledged_at=NOW()
     WHERE id=? AND status=? AND ack_token=?`,
    [STATUS.DONE, id, STATUS.PRINTING, token],
  )
  if (!ur.affectedRows) {
    throw new AppError('打印任务状态或确认令牌已变化，请刷新后重试', 409, 'PRINT_JOB_STATE_CONFLICT')
  }
  await printOptionalSideEffect('appendInboundPrintEvent:complete', appendInboundPrintEventByJob(
    job,
    'print_completed',
    '库存条码打印成功',
    job.refCode ? `库存条码 ${job.refCode} 已打印` : '库存条码已打印',
    { printJobId: job.id, barcode: job.refCode || null },
  ), { printJobId: job.id, refCode: job.refCode || null })
  if (latRow?.printer_id && latencyMs != null) {
    await printOptionalSideEffect(
      'recordPrintSuccess',
      recordPrintSuccess(latRow.printer_id, latencyMs),
      { printJobId: job.id, printerId: latRow.printer_id, latencyMs },
    )
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
    throw new AppError('任务状态已变更，请刷新后重试', 409, 'STATE_CONFLICT')
  }
  await printOptionalSideEffect('appendInboundPrintEvent:completeLocalDesktop', appendInboundPrintEventByJob(
    job,
    'print_completed',
    '库存条码打印成功',
    job.refCode ? `库存条码 ${job.refCode} 已打印` : '库存条码已打印',
    { printJobId: job.id, barcode: job.refCode || null },
  ), { printJobId: job.id, refCode: job.refCode || null })
  return findById(id)
}

async function fail(id, errorMessage) {
  const job = await findById(id)
  const retryCount = Math.min(Number(job.retryCount || 0) + 1, MAX_RETRY)

  const msg = errorMessage || '未知错误'
  const [ur] = await pool.query(
    `UPDATE print_jobs
     SET status=?, retry_count=?, error_message=?, ack_token=NULL, dispatched_at=NULL
     WHERE id=? AND status IN (?, ?)`,
    [STATUS.FAILED, retryCount, msg, id, STATUS.PENDING, STATUS.PRINTING],
  )
  if (!ur.affectedRows) {
    throw new AppError('打印任务状态已变化，无法标记失败', 409, 'PRINT_JOB_STATE_CONFLICT')
  }
  await printOptionalSideEffect(
    'recordPrintFailure',
    recordPrintFailure(job.printerId),
    { printJobId: job.id, printerId: job.printerId },
  )
  await printOptionalSideEffect('appendInboundPrintEvent:fail', appendInboundPrintEventByJob(
    job,
    'print_failed',
    '库存条码打印失败',
    msg,
    { printJobId: job.id, barcode: job.refCode || null, retryCount },
  ), { printJobId: job.id, nextStatus: STATUS.FAILED, retryCount })
  return findById(id)
}

async function retry(id) {
  await findById(id)
  const [ur] = await pool.query(
    `UPDATE print_jobs
     SET status=?, retry_count=0, error_message=NULL, ack_token=NULL, dispatched_at=NULL, expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE)
     WHERE id=? AND status=?`,
    [STATUS.PENDING, ttlMinutes(), id, STATUS.FAILED],
  )
  if (!ur.affectedRows) {
    throw new AppError('打印任务状态已变化，无法重试', 409, 'PRINT_JOB_STATE_CONFLICT')
  }
  return findById(id)
}

module.exports = {
  create,
  assertQueueReady,
  complete,
  completeLocalDesktop,
  fail,
  retry,
  createWithinTransaction,
  STATUS,
  MAX_RETRY,
}
