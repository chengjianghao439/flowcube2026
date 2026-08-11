const AppError = require('../../utils/AppError')
const { isStalledErrorMessage } = require('../print-jobs/print-jobs.service')
const { DEFAULT_INBOUND_THRESHOLDS } = require('../../utils/inboundThresholds')
const { assertStatusAction } = require('../../constants/documentStatusRules')

const RECEIPT_STATUS_LABEL = {
  draft: '草稿',
  submitted: '已提交',
  receiving: '收货中',
  printed_waiting_putaway: '待上架',
  putaway_in_progress: '上架中',
  audited: '已完成',
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
  not_ready: '未结算',
  approved: '已结算',
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

// 上架完成即自动结算（不再需要人工审核），audit_status 恒随 status→4 同一事务置为已通过。
function buildAuditStatus(task) {
  if (Number(task.status) === 5) return { key: 'cancelled', label: AUDIT_STATUS_LABEL.cancelled }
  if (Number(task.status) < 4) return { key: 'not_ready', label: AUDIT_STATUS_LABEL.not_ready }
  return { key: 'approved', label: AUDIT_STATUS_LABEL.approved }
}

function buildExceptionFlags(task) {
  const printSummary = task.printSummary || { failed: 0, timeout: 0 }
  const putawaySummary = task.putawaySummary || { overdueContainers: 0 }
  const flags = {
    failedPrintJobs: Number(printSummary.failed || 0),
    timeoutPrintJobs: Number(printSummary.timeout || 0),
    overduePutawayContainers: Number(putawaySummary.overdueContainers || 0),
  }
  return {
    ...flags,
    hasException: flags.failedPrintJobs > 0
      || flags.timeoutPrintJobs > 0
      || flags.overduePutawayContainers > 0,
  }
}

function buildReceiptStatus(task) {
  if (Number(task.status) === 5) return { key: 'cancelled', label: RECEIPT_STATUS_LABEL.cancelled }
  if (task.exceptionFlags?.hasException) return { key: 'exception', label: RECEIPT_STATUS_LABEL.exception }
  if (Number(task.auditStatus) === 1) return { key: 'audited', label: RECEIPT_STATUS_LABEL.audited }
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
  ) || (rawStatus === 3 && isStalledErrorMessage(row.error_message))

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

/**
 * 把本次收货的各箱数量分配到该商品的收货明细行，并给出「每一箱归属哪一行」。
 *
 * 分配顺序与历史实现完全一致（未收满的行按 id 升序依次填满，超收部分记在最后一行），
 * 只是改成逐箱推进，从而能记录每箱的归属——容器带上归属后，上架时才能把 putaway_qty
 * 精确回写到它真正所属的采购明细，而不是再猜一次（审计 P1-4）。
 *
 * 一箱跨两行时（前一行只差 3 件、这箱有 10 件），归属取该箱消耗最多的那一行；
 * 上架回写会先按归属行填，填不下的部分自然退回 first-fit 兜底，总量始终守恒。
 *
 * @returns {{ updates: {itemId:number, add:number}[], assignments: {lineNo:number, qty:number, itemId:number}[] }}
 */
function distributePackagesToLines(taskItems, productId, packages) {
  const allLines = taskItems.filter(i => i.productId === productId).sort((a, b) => a.id - b.id)
  if (!allLines.length) throw new AppError('该商品不属于当前收货任务', 400)

  // 剩余可填容量队列：与旧实现同序（未收满的行按 id 升序）
  const capacity = allLines
    .filter(i => i.receivedQty < i.orderedQty)
    .map(line => ({ itemId: line.id, left: line.orderedQty - line.receivedQty }))
  const lastLineId = allLines[allLines.length - 1].id

  const addedByItem = new Map()
  const assignments = []
  let cursor = 0

  for (const pkg of packages) {
    let pkgLeft = +pkg.qty
    // 本箱在各行的消耗量，用于决定归属（取消耗最多的一行）
    const consumed = new Map()

    while (pkgLeft > 0 && cursor < capacity.length) {
      const slot = capacity[cursor]
      if (slot.left <= 0) { cursor += 1; continue }
      const take = Math.min(slot.left, pkgLeft)
      slot.left -= take
      pkgLeft -= take
      consumed.set(slot.itemId, (consumed.get(slot.itemId) || 0) + take)
      addedByItem.set(slot.itemId, (addedByItem.get(slot.itemId) || 0) + take)
      if (slot.left <= 0) cursor += 1
    }

    // 超收：供应商多发货是常见场景，不硬性拒绝。超出部分记在最后一行，
    // received_qty > ordered_qty 会在 ERP 端自然呈现为"超收"。
    // 收货侧的金额/比例双闸门与留痕见 inbound-tasks.command.js 的 assertOverReceiveAllowed。
    if (pkgLeft > 0) {
      consumed.set(lastLineId, (consumed.get(lastLineId) || 0) + pkgLeft)
      addedByItem.set(lastLineId, (addedByItem.get(lastLineId) || 0) + pkgLeft)
      pkgLeft = 0
    }

    let ownerItemId = lastLineId
    let ownerQty = -1
    for (const [itemId, qty] of consumed) {
      if (qty > ownerQty) { ownerQty = qty; ownerItemId = itemId }
    }
    assignments.push({ lineNo: pkg.lineNo, qty: +pkg.qty, itemId: ownerItemId })
  }

  const updates = [...addedByItem.entries()]
    .filter(([, add]) => add > 0)
    .map(([itemId, add]) => ({ itemId, add }))
  return { updates, assignments }
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
  assertStatusAction('inboundTask', 'submit', Number(taskRow.status))
  if (taskRow.submitted_at) throw new AppError('该收货订单已提交到 PDA', 400)
}

function assertTaskCanReceive(taskRow) {
  assertStatusAction('inboundTask', 'receive', Number(taskRow.status))
  if (!taskRow.submitted_at) throw new AppError('请先在 ERP 提交到 PDA，再开始收货', 400)
}

function assertTaskCanPutaway(taskRow) {
  assertStatusAction('inboundTask', 'putaway', Number(taskRow.status))
}

function assertTaskCanCancel(task) {
  assertStatusAction('inboundTask', 'cancel', Number(task.status))
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
  distributePackagesToLines,
  ensureInboundTaskExists,
  assertTaskCanSubmit,
  assertTaskCanReceive,
  assertTaskCanPutaway,
  assertTaskCanCancel,
}
