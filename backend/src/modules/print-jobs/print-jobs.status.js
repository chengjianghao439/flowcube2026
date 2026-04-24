const AppError = require('../../utils/AppError')
const { DEFAULT_INBOUND_THRESHOLDS } = require('../../utils/inboundThresholds')

const STATUS = { PENDING: 0, PRINTING: 1, DONE: 2, FAILED: 3 }
const MAX_RETRY = 3
const EXPIRE_MESSAGE = 'no printer available'
const STATUS_KEY = ['pending', 'printing', 'success', 'failed']

function ttlMinutes() {
  const n = Number(process.env.PRINT_JOB_TTL_MINUTES)
  return Number.isFinite(n) && n > 0 ? n : 30
}

function statusKey(n) {
  const i = Number(n)
  return STATUS_KEY[i] ?? 'unknown'
}

function printStateLabel(n) {
  switch (Number(n)) {
    case STATUS.PENDING: return '排队中'
    case STATUS.PRINTING: return '打印中'
    case STATUS.DONE: return '已打印'
    case STATUS.FAILED: return '打印失败'
    default: return '未知'
  }
}

function parsePriority(raw) {
  if (raw === 1 || raw === '1') return 1
  const s = String(raw || '').toLowerCase()
  if (s === 'high') return 1
  return 0
}

function parseListStatus(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined
  const map = {
    pending: STATUS.PENDING,
    printing: STATUS.PRINTING,
    success: STATUS.DONE,
    done: STATUS.DONE,
    failed: STATUS.FAILED,
  }
  const key = String(raw).toLowerCase()
  if (map[key] !== undefined) return map[key]
  const n = Number(raw)
  return Number.isNaN(n) ? undefined : n
}

function normalizeBarcodeQueryKeyword(raw) {
  return String(raw || '').trim()
}

function normalizeBarcodeRecordStatus(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = String(raw).trim().toLowerCase()
  if (['pending', 'queued', 'printing', 'success', 'failed', 'timeout', 'cancelled'].includes(value)) {
    return value === 'pending' ? 'queued' : value
  }
  return undefined
}

function deriveInboundBarcodeStatus(row, thresholds = DEFAULT_INBOUND_THRESHOLDS) {
  const rawStatus = row.print_status != null ? Number(row.print_status) : null
  const thresholdMinutes = Number(thresholds.printTimeoutMinutes || DEFAULT_INBOUND_THRESHOLDS.printTimeoutMinutes)
  const timeoutByAge = rawStatus != null
    && (rawStatus === STATUS.PENDING || rawStatus === STATUS.PRINTING)
    && row.print_updated_at
    && (Date.now() - new Date(row.print_updated_at).getTime()) >= thresholdMinutes * 60 * 1000
  const timeoutByError = rawStatus === STATUS.FAILED && String(row.error_message || '') === EXPIRE_MESSAGE

  if (Number(row.inbound_task_status) === 5) return { statusKey: 'cancelled', printStateLabel: '已取消' }
  if (timeoutByAge || timeoutByError) return { statusKey: 'timeout', printStateLabel: '超时待确认' }
  if (rawStatus === STATUS.DONE) return { statusKey: 'success', printStateLabel: '已打印' }
  if (rawStatus === STATUS.FAILED) return { statusKey: 'failed', printStateLabel: '打印失败' }
  if (rawStatus === STATUS.PRINTING) return { statusKey: 'printing', printStateLabel: '打印中' }
  if (rawStatus === STATUS.PENDING) return { statusKey: 'queued', printStateLabel: '待派发' }
  return { statusKey: 'queued', printStateLabel: '待派发' }
}

function deriveGenericBarcodeStatus(row) {
  const rawStatus = row.print_status != null ? Number(row.print_status) : Number(row.status)
  if (rawStatus === STATUS.FAILED && String(row.error_message || '') === EXPIRE_MESSAGE) {
    return { statusKey: 'timeout', printStateLabel: '超时待确认' }
  }
  if (rawStatus === STATUS.DONE) return { statusKey: 'success', printStateLabel: '已打印' }
  if (rawStatus === STATUS.FAILED) return { statusKey: 'failed', printStateLabel: '打印失败' }
  if (rawStatus === STATUS.PRINTING) return { statusKey: 'printing', printStateLabel: '打印中' }
  if (rawStatus === STATUS.PENDING) return { statusKey: 'queued', printStateLabel: '待派发' }
  return { statusKey: 'queued', printStateLabel: '待派发' }
}

function assertCanComplete(job) {
  if (job.status === STATUS.DONE) return
  if (job.status === STATUS.FAILED) {
    throw new AppError('任务已失败，无法标记为完成', 400, 'PRINT_JOB_ALREADY_FAILED')
  }
}

function assertCanCompleteLocalDesktop(job, ackTokenPresent) {
  if (job.status === STATUS.DONE) return
  if (job.status === STATUS.FAILED) {
    throw new AppError('任务已失败，无法核销', 400, 'PRINT_JOB_ALREADY_FAILED')
  }
  if (job.status === STATUS.PRINTING) {
    throw new AppError('任务已被打印工作站领取，无法本机核销', 409, 'PRINT_JOB_CLAIMED_BY_CLIENT')
  }
  if (job.status !== STATUS.PENDING) {
    throw new AppError('无法核销该任务', 400, 'PRINT_JOB_COMPLETE_INVALID')
  }
  if (ackTokenPresent) {
    throw new AppError('任务已下发至工作站，请使用打印客户端确认完成', 409, 'PRINT_JOB_LOCAL_COMPLETE_FORBIDDEN')
  }
}

function nextFailState(job) {
  if (job.status === STATUS.DONE) return { done: true, retryCount: job.retryCount, status: STATUS.DONE }
  if (job.status === STATUS.FAILED && job.retryCount >= MAX_RETRY) {
    return { done: true, retryCount: job.retryCount, status: STATUS.FAILED }
  }
  const retryCount = Number(job.retryCount || 0) + 1
  return {
    done: false,
    retryCount,
    status: retryCount >= MAX_RETRY ? STATUS.FAILED : STATUS.PENDING,
  }
}

module.exports = {
  STATUS,
  MAX_RETRY,
  EXPIRE_MESSAGE,
  ttlMinutes,
  statusKey,
  printStateLabel,
  parsePriority,
  parseListStatus,
  normalizeBarcodeQueryKeyword,
  normalizeBarcodeRecordStatus,
  deriveInboundBarcodeStatus,
  deriveGenericBarcodeStatus,
  assertCanComplete,
  assertCanCompleteLocalDesktop,
  nextFailState,
}
