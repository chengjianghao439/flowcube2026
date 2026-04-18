const AppError = require('../../utils/AppError')
const { EXPIRE_MESSAGE } = require('../print-jobs/print-jobs.service')
const { DEFAULT_INBOUND_THRESHOLDS } = require('../../utils/inboundThresholds')

const RECEIPT_STATUS_LABEL = {
  draft: '草稿',
  submitted: '已提交到PDA',
  receiving: '收货中',
  printed_waiting_putaway: '已打印待上架',
  putaway_in_progress: '上架中',
  pending_audit: '已上架待审核',
  audited: '已审核',
  exception: '异常中',
  cancelled: '已取消',
}
const PRINT_STATUS_LABEL = {
  not_started: '未打印',
  queued: '待派发',
  printing: '打印中',
  success: '已打印',
  failed: '打印失败',
  timeout: '超时待确认',
  cancelled: '已取消',
}
const PUTAWAY_STATUS_LABEL = {
  not_started: '未开始',
  waiting: '待上架',
  putting_away: '上架中',
  completed: '已上架',
  cancelled: '已取消',
}
const AUDIT_STATUS_LABEL = {
  not_ready: '未到审核',
  pending: '待审核',
  approved: '已审核',
  rejected: '已退回',
  cancelled: '已取消',
}

function buildPrintStatus(summary, cancelled = false) {
  if (cancelled) return { key: 'cancelled', label: PRINT_STATUS_LABEL.cancelled }
  if (!summary || !summary.total) return { key: 'not_started', label: PRINT_STATUS_LABEL.not_started }
  if (summary.timeout > 0) return { key: 'timeout', label: PRINT_STATUS_LABEL.timeout }
  if (summary.failed > 0) return { key: 'failed', label: PRINT_STATUS_LABEL.failed }
  if (summary.printing > 0) return { key: 'printing', label: PRINT_STATUS_LABEL.printing }
  if (summary.queued > 0) return { key: 'queued', label: PRINT_STATUS_LABEL.queued }
  if (summary.success > 0) return { key: 'success', label: PRINT_STATUS_LABEL.success }
  return { key: 'not_started', label: PRINT_STATUS_LABEL.not_started }
}

function buildPutawayStatus(summary, cancelled = false) {
  if (cancelled) return { key: 'cancelled', label: PUTAWAY_STATUS_LABEL.cancelled }
  if (!summary || (!summary.waitingContainers && !summary.storedContainers)) {
    return { key: 'not_started', label: PUTAWAY_STATUS_LABEL.not_started }
  }
  if (summary.waitingContainers > 0 && summary.storedContainers > 0) {
    return { key: 'putting_away', label: PUTAWAY_STATUS_LABEL.putting_away }
  }
  if (summary.waitingContainers > 0) return { key: 'waiting', label: PUTAWAY_STATUS_LABEL.waiting }
  return { key: 'completed', label: PUTAWAY_STATUS_LABEL.completed }
}

function buildAuditStatus(task) {
  if (Number(task.status) === 5) return { key: 'cancelled', label: AUDIT_STATUS_LABEL.cancelled }
  if (Number(task.status) < 4) return { key: 'not_ready', label: AUDIT_STATUS_LABEL.not_ready }
  if (Number(task.auditStatus) === 1) return { key: 'approved', label: AUDIT_STATUS_LABEL.approved }
  if (Number(task.auditStatus) === 2) return { key: 'rejected', label: AUDIT_STATUS_LABEL.rejected }
  return { key: 'pending', label: AUDIT_STATUS_LABEL.pending }
}

function buildExceptionFlags(task) {
  const printSummary = task.printSummary || { failed: 0, timeout: 0 }
  const putawaySummary = task.putawaySummary || { overdueContainers: 0 }
  const isPendingAuditOverdue = Number(task.status) === 4
    && Number(task.auditStatus) === 0
    && !!task.updatedAt
    && (Date.now() - new Date(task.updatedAt).getTime()) > Number(task.auditTimeoutHours || DEFAULT_INBOUND_THRESHOLDS.auditTimeoutHours) * 60 * 60 * 1000
  const flags = {
    failedPrintJobs: Number(printSummary.failed || 0),
    timeoutPrintJobs: Number(printSummary.timeout || 0),
    overduePutawayContainers: Number(putawaySummary.overdueContainers || 0),
    pendingAuditOverdue: isPendingAuditOverdue,
    auditRejected: Number(task.auditStatus) === 2,
  }
  return {
    ...flags,
    hasException: flags.failedPrintJobs > 0
      || flags.timeoutPrintJobs > 0
      || flags.overduePutawayContainers > 0
      || flags.pendingAuditOverdue
      || flags.auditRejected,
  }
}

function buildReceiptStatus(task) {
  if (Number(task.status) === 5) return { key: 'cancelled', label: RECEIPT_STATUS_LABEL.cancelled }
  if (task.exceptionFlags?.hasException) return { key: 'exception', label: RECEIPT_STATUS_LABEL.exception }
  if (Number(task.auditStatus) === 1) return { key: 'audited', label: RECEIPT_STATUS_LABEL.audited }
  if (Number(task.status) === 4) return { key: 'pending_audit', label: RECEIPT_STATUS_LABEL.pending_audit }
  if (task.putawayStatus?.key === 'putting_away') return { key: 'putaway_in_progress', label: RECEIPT_STATUS_LABEL.putaway_in_progress }
  if (Number(task.status) === 3) return { key: 'printed_waiting_putaway', label: RECEIPT_STATUS_LABEL.printed_waiting_putaway }
  if (Number(task.status) === 2) return { key: 'receiving', label: RECEIPT_STATUS_LABEL.receiving }
  if (task.submittedAt) return { key: 'submitted', label: RECEIPT_STATUS_LABEL.submitted }
  return { key: 'draft', label: RECEIPT_STATUS_LABEL.draft }
}

function deriveInboundPrintJobState(row, thresholds = DEFAULT_INBOUND_THRESHOLDS) {
  const rawStatus = Number(row.status)
  const timedOut = (
    (rawStatus === 0 || rawStatus === 1)
      && !!row.updated_at
      && (Date.now() - new Date(row.updated_at).getTime()) >= Number(thresholds.printTimeoutMinutes || DEFAULT_INBOUND_THRESHOLDS.printTimeoutMinutes) * 60 * 1000
  ) || (rawStatus === 3 && String(row.error_message || '') === EXPIRE_MESSAGE)

  const base = (statusKey, statusLabel) => ({
    key: statusKey,
    label: statusLabel,
    statusKey,
    statusLabel,
  })

  if (Number(row.task_status) === 5) return base('cancelled', PRINT_STATUS_LABEL.cancelled)
  if (timedOut) return base('timeout', PRINT_STATUS_LABEL.timeout)
  if (rawStatus === 2) return base('success', PRINT_STATUS_LABEL.success)
  if (rawStatus === 3) return base('failed', PRINT_STATUS_LABEL.failed)
  if (rawStatus === 1) return base('printing', PRINT_STATUS_LABEL.printing)
  if (rawStatus === 0) return base('queued', PRINT_STATUS_LABEL.queued)
  return base('queued', PRINT_STATUS_LABEL.queued)
}

function getInboundPrintDispatchReasonLabel(reason) {
  switch (String(reason || '').toLowerCase()) {
    case 'manual_reprint':
      return '补打批次'
    case 'explicit':
      return '手动指定打印机'
    case 'fallback':
      return '自动回退打印'
    default:
      return reason ? `打印批次 · ${reason}` : '打印批次'
  }
}

function buildInboundBatchStatus(summary) {
  if (summary.cancelled > 0) return { key: 'cancelled', label: PRINT_STATUS_LABEL.cancelled }
  if (summary.timeout > 0) return { key: 'timeout', label: PRINT_STATUS_LABEL.timeout }
  if (summary.failed > 0) return { key: 'failed', label: PRINT_STATUS_LABEL.failed }
  if (summary.printing > 0) return { key: 'printing', label: PRINT_STATUS_LABEL.printing }
  if (summary.queued > 0) return { key: 'queued', label: PRINT_STATUS_LABEL.queued }
  return { key: 'success', label: PRINT_STATUS_LABEL.success }
}

function buildInboundPrintBatches(recentPrintJobs = []) {
  if (!Array.isArray(recentPrintJobs) || !recentPrintJobs.length) return []
  const orderedJobs = [...recentPrintJobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const batches = []
  const batchWindowMs = 45 * 1000

  for (const job of orderedJobs) {
    const createdAtMs = new Date(job.createdAt).getTime()
    const prev = batches[batches.length - 1]
    const canMerge = prev
      && prev.dispatchReason === (job.dispatchReason || null)
      && Math.abs(prev.anchorCreatedAtMs - createdAtMs) <= batchWindowMs
    if (canMerge) {
      prev.jobs.push(job)
      prev.anchorCreatedAtMs = Math.max(prev.anchorCreatedAtMs, createdAtMs)
      continue
    }
    batches.push({
      batchKey: `batch:${job.dispatchReason || 'default'}:${job.id}`,
      dispatchReason: job.dispatchReason || null,
      anchorCreatedAtMs: createdAtMs,
      jobs: [job],
    })
  }

  return batches.map(batch => {
    const summary = {
      total: batch.jobs.length,
      queued: 0,
      printing: 0,
      success: 0,
      failed: 0,
      timeout: 0,
      cancelled: 0,
    }
    const printerNames = new Set()
    const barcodes = []
    let latestErrorMessage = null
    let firstCreatedAt = batch.jobs[0]?.createdAt || null
    let lastUpdatedAt = batch.jobs[0]?.updatedAt || null

    for (const job of batch.jobs) {
      if (summary[job.statusKey] != null) summary[job.statusKey] += 1
      if (job.printerName || job.printerCode) printerNames.add(job.printerName || job.printerCode)
      if (job.barcode) barcodes.push(job.barcode)
      if (!latestErrorMessage && job.errorMessage) latestErrorMessage = job.errorMessage
      if (job.createdAt && (!firstCreatedAt || new Date(job.createdAt).getTime() < new Date(firstCreatedAt).getTime())) {
        firstCreatedAt = job.createdAt
      }
      if (job.updatedAt && (!lastUpdatedAt || new Date(job.updatedAt).getTime() > new Date(lastUpdatedAt).getTime())) {
        lastUpdatedAt = job.updatedAt
      }
    }

    const statusView = buildInboundBatchStatus(summary)
    return {
      batchKey: batch.batchKey,
      title: batch.dispatchReason === 'manual_reprint' ? '补打结果回写' : getInboundPrintDispatchReasonLabel(batch.dispatchReason),
      dispatchReason: batch.dispatchReason,
      dispatchReasonLabel: getInboundPrintDispatchReasonLabel(batch.dispatchReason),
      statusKey: statusView.key,
      statusLabel: statusView.label,
      total: summary.total,
      queued: summary.queued,
      printing: summary.printing,
      success: summary.success,
      failed: summary.failed,
      timeout: summary.timeout,
      cancelled: summary.cancelled,
      firstCreatedAt,
      lastUpdatedAt,
      printerNames: [...printerNames],
      barcodes: [...new Set(barcodes)].slice(0, 6),
      latestErrorMessage,
    }
  })
}

function distributeQtyToLines(taskItems, productId, qty) {
  const lines = taskItems
    .filter(i => i.productId === productId && i.receivedQty < i.orderedQty)
    .sort((a, b) => a.id - b.id)
  let left = +qty
  const updates = []
  for (const line of lines) {
    const cap = line.orderedQty - line.receivedQty
    const add = Math.min(left, cap)
    if (add > 0) {
      updates.push({ itemId: line.id, add })
      left -= add
    }
    if (left <= 0) break
  }
  if (left > 0) throw new AppError('收货数量超过该商品待收数量', 400)
  return updates
}

async function ensureInboundTaskExists(conn, taskId) {
  const [[taskRow]] = await conn.query(
    `SELECT id, task_no, status, audit_status, updated_at
     FROM inbound_tasks
     WHERE id = ? AND deleted_at IS NULL`,
    [taskId],
  )
  if (!taskRow) throw new AppError('收货订单不存在', 404)
  return taskRow
}

function assertTaskCanSubmit(taskRow) {
  if (Number(taskRow.status) === 5) throw new AppError('已取消的收货订单不能提交到 PDA', 400)
  if (taskRow.submitted_at) throw new AppError('该收货订单已提交到 PDA', 400)
}

function assertTaskCanAudit(taskRow) {
  if (Number(taskRow.status) !== 4) throw new AppError('只有已上架完成的收货订单才能审核', 400)
}

function assertTaskCanReceive(taskRow) {
  if (Number(taskRow.status) >= 4) throw new AppError('任务已完成或已取消', 400)
  if (!taskRow.submitted_at) throw new AppError('请先在 ERP 提交到 PDA，再开始收货', 400)
  if (Number(taskRow.status) === 3) throw new AppError('任务已全部收货，请执行上架', 400)
}

function assertTaskCanPutaway(taskRow) {
  const ts = Number(taskRow.status)
  if (ts >= 4) throw new AppError('任务已完成或已取消', 400)
  if (ts === 1) throw new AppError('任务尚未开始收货，无法上架', 400)
}

function assertTaskCanCancel(task) {
  if (task.status !== 1) throw new AppError('仅待收货状态的任务可取消', 400)
}

module.exports = {
  DEFAULT_INBOUND_THRESHOLDS,
  buildPrintStatus,
  buildPutawayStatus,
  buildAuditStatus,
  buildExceptionFlags,
  buildReceiptStatus,
  deriveInboundPrintJobState,
  getInboundPrintDispatchReasonLabel,
  buildInboundPrintBatches,
  distributeQtyToLines,
  ensureInboundTaskExists,
  assertTaskCanSubmit,
  assertTaskCanAudit,
  assertTaskCanReceive,
  assertTaskCanPutaway,
  assertTaskCanCancel,
}
