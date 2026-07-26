const AppError = require('../../utils/AppError')
const { DEFAULT_INBOUND_THRESHOLDS } = require('../../utils/inboundThresholds')

const STATUS = { PENDING: 0, PRINTING: 1, DONE: 2, FAILED: 3 }
const MAX_RETRY = 3
const EXPIRE_MESSAGE = 'no printer available'
/** 领取任务的桌面客户端失联，任务被回收（区别于 TTL 到期，便于排障时分辨两种停滞原因） */
const CLIENT_OFFLINE_MESSAGE = 'print client went offline'
const STATUS_KEY = ['pending', 'printing', 'success', 'failed']

function ttlMinutes() {
  const n = Number(process.env.PRINT_JOB_TTL_MINUTES)
  return Number.isFinite(n) && n > 0 ? n : 30
}

/** 客户端失联多久后回收其领取的打印中任务（秒）。需大于「在线」判定阈值 30s，给打印本身留出余量 */
function clientOfflineReclaimSeconds() {
  const n = Number(process.env.PRINT_JOB_CLIENT_OFFLINE_RECLAIM_SECONDS)
  return Number.isFinite(n) && n > 0 ? n : 120
}

/** 两类停滞（TTL 到期 / 客户端失联回收）对用户都表现为「超时待确认」 */
function isStalledErrorMessage(msg) {
  const s = String(msg || '')
  return s === EXPIRE_MESSAGE || s === CLIENT_OFFLINE_MESSAGE
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
  if (['no_job', 'pending', 'queued', 'printing', 'success', 'failed', 'timeout', 'cancelled'].includes(value)) {
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
  const timeoutByError = rawStatus === STATUS.FAILED && isStalledErrorMessage(row.error_message)

  if (Number(row.inbound_task_status) === 5) return { statusKey: 'cancelled', printStateLabel: '已取消' }
  if (timeoutByAge || timeoutByError) return { statusKey: 'timeout', printStateLabel: '超时待确认' }
  if (rawStatus === STATUS.DONE) return { statusKey: 'success', printStateLabel: '已打印' }
  if (rawStatus === STATUS.FAILED) return { statusKey: 'failed', printStateLabel: '打印失败' }
  if (rawStatus === STATUS.PRINTING) return { statusKey: 'printing', printStateLabel: '打印中' }
  if (rawStatus === STATUS.PENDING) return { statusKey: 'queued', printStateLabel: '待派发' }
  return { statusKey: 'no_job', printStateLabel: '未生成打印任务' }
}

function deriveGenericBarcodeStatus(row) {
  // 两种查询形状：LEFT JOIN 打印任务时取 print_status，行本身即 print_jobs 时取 status。
  // 两者都为空必须落到 no_job —— 不能让 Number(null)===0 把「没有打印任务」误显示为「待派发」。
  const source = row.print_status != null ? row.print_status : row.status
  const rawStatus = source != null ? Number(source) : NaN
  if (rawStatus === STATUS.FAILED && isStalledErrorMessage(row.error_message)) {
    return { statusKey: 'timeout', printStateLabel: '超时待确认' }
  }
  if (rawStatus === STATUS.DONE) return { statusKey: 'success', printStateLabel: '已打印' }
  if (rawStatus === STATUS.FAILED) return { statusKey: 'failed', printStateLabel: '打印失败' }
  if (rawStatus === STATUS.PRINTING) return { statusKey: 'printing', printStateLabel: '打印中' }
  if (rawStatus === STATUS.PENDING) return { statusKey: 'queued', printStateLabel: '待派发' }
  return { statusKey: 'no_job', printStateLabel: '未生成打印任务' }
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

module.exports = {
  STATUS,
  MAX_RETRY,
  EXPIRE_MESSAGE,
  CLIENT_OFFLINE_MESSAGE,
  isStalledErrorMessage,
  ttlMinutes,
  clientOfflineReclaimSeconds,
  statusKey,
  printStateLabel,
  parsePriority,
  parseListStatus,
  normalizeBarcodeQueryKeyword,
  normalizeBarcodeRecordStatus,
  deriveInboundBarcodeStatus,
  deriveGenericBarcodeStatus,
  assertCanCompleteLocalDesktop,
}
