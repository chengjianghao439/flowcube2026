const AppError = require('../../utils/AppError')
const { DEFAULT_INBOUND_THRESHOLDS } = require('../../utils/inboundThresholds')
// 容器状态常量从引擎引入而不是本地再写一个 3：语义只允许有一处定义，
// 副本一旦分叉就会出现「显示为作废、筛选却当有效」这类无声错位。
const { CONTAINER_STATUS } = require('../../engine/containerEngine')

const STATUS = { PENDING: 0, PRINTING: 1, DONE: 2, FAILED: 3 }
const MAX_RETRY = 3
const EXPIRE_MESSAGE = 'no printer available'
/** 领取任务的桌面客户端失联，任务被回收（区别于 TTL 到期，便于排障时分辨两种停滞原因） */
const CLIENT_OFFLINE_MESSAGE = 'print client went offline'
/**
 * 容器被作废（撤回收货等）后，其**尚未被领取**的打印任务被终结时写入的文本。
 * 与上面两条同族的「停滞原因」，排障时可据此分辨「为什么这张标签没打出来」。
 * 刻意不新增终态：print_jobs.status 只有 PENDING/PRINTING/DONE/FAILED，全仓也没有
 * 「取消打印任务」的路径，加状态会牵动状态机、前端显示与过期扫描多处。
 */
const CONTAINER_VOID_MESSAGE = 'container voided'
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
  if (['no_job', 'unassigned', 'pending', 'queued', 'printing', 'success', 'failed', 'timeout', 'cancelled', 'voided'].includes(value)) {
    return value === 'pending' ? 'queued' : value
  }
  return undefined
}

// 无设备留档与 TTL 回收沿用同一错误文本，须结合设备归属区分；渲染失败不可误归为缺设备。
function isUnassignedBarcodeJob(row, rawStatus) {
  return rawStatus === STATUS.FAILED && row.printer_id === null && row.error_message === EXPIRE_MESSAGE
}

/**
 * 「最近一次打印任务」自身的**结果**——只反映这条 print_job 发生了什么，
 * **不掺容器的业务状态**。
 *
 * 与 `deriveInboundBarcodeStatus` 分开是必须的：作废容器既有的 print_jobs 往往仍是 DONE，
 * 若把业务状态与任务结果压在同一个字段里，作废会把「最近任务：已打印」整个覆盖掉
 * （2026-09-27 GUI 验收发现：VOID 行只剩「条码已作废」，看不出这张标签当初打没打出来）。
 */
function deriveInboundPrintJobResult(row, thresholds = DEFAULT_INBOUND_THRESHOLDS) {
  const rawStatus = row.print_status != null ? Number(row.print_status) : null
  const thresholdMinutes = Number(thresholds.printTimeoutMinutes || DEFAULT_INBOUND_THRESHOLDS.printTimeoutMinutes)
  const timeoutByAge = rawStatus != null
    && (rawStatus === STATUS.PENDING || rawStatus === STATUS.PRINTING)
    && row.print_updated_at
    && (Date.now() - new Date(row.print_updated_at).getTime()) >= thresholdMinutes * 60 * 1000
  const timeoutByError = rawStatus === STATUS.FAILED && isStalledErrorMessage(row.error_message)

  // 因容器作废被撤回终结的任务：**不是「打印失败」，而是根本没出纸**，措辞必须说清；
  // 也不能沿用「可尝试补打」的失败文案——补打入口对作废容器是明确拒绝的。
  if (rawStatus === STATUS.FAILED && String(row.error_message || '') === CONTAINER_VOID_MESSAGE) {
    return { statusKey: 'voided_job', printStateLabel: '未出纸（库存条码已作废）' }
  }
  if (isUnassignedBarcodeJob(row, rawStatus)) return { statusKey: 'unassigned', printStateLabel: '未配置打印机' }
  if (timeoutByAge || timeoutByError) return { statusKey: 'timeout', printStateLabel: '超时待确认' }
  if (rawStatus === STATUS.DONE) return { statusKey: 'success', printStateLabel: '已打印' }
  if (rawStatus === STATUS.FAILED) return { statusKey: 'failed', printStateLabel: '打印失败' }
  if (rawStatus === STATUS.PRINTING) return { statusKey: 'printing', printStateLabel: '打印中' }
  if (rawStatus === STATUS.PENDING) return { statusKey: 'queued', printStateLabel: '待派发' }
  return { statusKey: 'no_job', printStateLabel: '未生成打印任务' }
}

/**
 * 条码的**业务状态**（行级）：容器作废 > 收货单取消 > 最近打印任务结果。
 *
 * 容器作废优先于一切打印状态：撤回收货会把 remaining_qty 归零并置 VOID，
 * 但该容器既有的 print_jobs 仍是 DONE，只按打印状态派生会显示成「已打印」并可补打。
 * 只对 VOID 收紧；EMPTY/待上架/待质检/拒收的容器仍有实物，补打是正当需求。
 * 注意：它只决定**行级状态列**；「最近任务结果」由 `deriveInboundPrintJobResult` 单独给出。
 */
function deriveInboundBarcodeStatus(row, thresholds = DEFAULT_INBOUND_THRESHOLDS) {
  if (Number(row.container_status) === CONTAINER_STATUS.VOID) {
    return {
      statusKey: 'voided',
      printStateLabel: '条码已作废',
      // 作废原因：目前只有撤回收货写 move_type=11 的库存流水，销售退货/调拨置 VOID 不写，
      // 故取不到时只报「已作废」而不猜原因。
      voidReasonLabel: Number(row.void_by_receipt_void) === 1 ? '入库撤回' : null,
    }
  }

  if (Number(row.inbound_task_status) === 5) return { statusKey: 'cancelled', printStateLabel: '已取消' }
  return deriveInboundPrintJobResult(row, thresholds)
}

function deriveGenericBarcodeStatus(row) {
  // 两种查询形状：LEFT JOIN 打印任务时取 print_status，行本身即 print_jobs 时取 status。
  // 两者都为空必须落到 no_job —— 不能让 Number(null)===0 把「没有打印任务」误显示为「待派发」。
  const source = row.print_status != null ? row.print_status : row.status
  const rawStatus = source != null ? Number(source) : NaN
  if (isUnassignedBarcodeJob(row, rawStatus)) return { statusKey: 'unassigned', printStateLabel: '未配置打印机' }
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
  CONTAINER_VOID_MESSAGE,
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
  deriveInboundPrintJobResult,
  deriveGenericBarcodeStatus,
  assertCanCompleteLocalDesktop,
}
