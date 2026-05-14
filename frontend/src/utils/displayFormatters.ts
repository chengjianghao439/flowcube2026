type PrintStatusKey = 'no_job' | 'queued' | 'printing' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'unknown' | string

const BACKEND_CODE_LABELS: Record<string, string> = {
  PRINT_JOB_STATE_CONFLICT: '打印任务状态已变化，请刷新后重试',
  WAREHOUSE_TASK_PRIORITY_STATUS_CONFLICT: '任务状态已变化，无法修改优先级',
  PDA_SESSION_INVALID: 'PDA 设备会话无效',
  INVENTORY_NOT_ENOUGH: '库存不足',
  CONTAINER_LOCK_CONFLICT: '容器已被其它任务占用',
  UNAUTHORIZED: '请先登录',
  FORBIDDEN: '无权限操作',
  NOT_FOUND: '数据不存在或已被删除',
  CONFLICT: '状态已变化，请刷新后重试',
  REQUEST_TIMEOUT: '请求超时，请稍后重试',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
}

const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  ORPHANED_RESERVATION: '孤立预占异常',
  INBOUND_PRINT_FAILED: '入库打印失败',
  OUTBOUND_PRINT_FAILED: '出库打印失败',
  CONFIRMED_SALE_NO_RESERVATION: '销售单预占缺失',
  HIGH_PRIORITY_TASK_DELAY: '高优先级任务延误',
  SHIPPED_TASK_UNSYNCED_SALE: '出库未同步销售单',
  ORPHANED_SORTING_BIN: '孤立分拣格异常',
  ORPHANED_CONTAINER_LOCK: '库存容器锁定异常',
  LONG_PENDING_RESERVATION: '长期未处理预占',
  RESERVED_EXCEEDS_ON_HAND: '预占超过在库',
  NEGATIVE_ON_HAND: '库存数量异常',
  INBOUND_PUTAWAY_TIMEOUT: '入库上架超时',
  INBOUND_AUDIT_TIMEOUT: '入库审核超时',
  INBOUND_AUDIT_REJECTED: '入库审核退回',
  WAVE_STALE_PICKING: '波次拣货停滞',
  WAVE_STALE_SORTING: '波次分拣停滞',
}

const DATABASE_TABLE_LABELS: Record<string, string> = {
  warehouse_tasks: '仓库任务',
  inventory_containers: '库存容器',
  stock_reservations: '库存预占记录',
  print_jobs: '打印任务',
  inbound_tasks: '入库任务',
  picking_waves: '波次拣货',
  sorting_bins: '分拣格',
  packages: '包裹',
  scan_logs: '扫码记录',
  users: '用户',
  roles: '角色权限',
  warehouses: '仓库',
  products: '商品',
  sales: '销售单',
  purchase_orders: '采购单',
}

const PRINT_REASON_LABELS: Record<string, string> = {
  default: '默认打印任务',
  reprint: '补打任务',
  auto: '系统自动打印',
  manual: '手动打印',
}

const PRINT_STATUS_LABELS: Record<string, string> = {
  no_job: '尚未生成打印任务',
  queued: '打印任务已生成，等待打印客户端领取',
  printing: '打印中',
  success: '已打印',
  failed: '打印失败，可尝试补打',
  timeout: '打印超时，请确认打印机状态',
  cancelled: '打印任务已取消',
  unknown: '打印状态未知',
}

const PDA_ERROR_LABELS: Record<string, string> = {
  容器商品不属于当前任务: '这个货不是当前任务要拣的商品',
  该商品不属于当前任务: '这个货不是当前任务要拣的商品',
  容器仓库与任务仓库不一致: '这个货不在当前任务仓库',
  容器条码不匹配: '条码和系统记录不一致',
  容器状态不可拣货: '这个货当前不能拣',
  容器已被其它任务锁定: '这个货已被其它任务占用',
  CONTAINER_LOCK_CONFLICT: '这个货已被其它任务占用',
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function hasChinese(value: string): boolean {
  return /[\u4e00-\u9fa5]/.test(value)
}

function looksLikeTechnicalValue(value: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(value)
    || /^[a-z]+(_[a-z0-9]+)+$/.test(value)
    || /(Error|Exception|Traceback|ECONN|ETIMEDOUT|EAI_AGAIN|undefined|null)/i.test(value)
}

export function formatBackendCode(code: unknown, fallback = '操作失败，请稍后重试'): string {
  const raw = asTrimmedString(code)
  if (!raw) return fallback
  const upper = raw.toUpperCase()
  if (BACKEND_CODE_LABELS[upper]) return BACKEND_CODE_LABELS[upper]
  if (upper.endsWith('_CONFLICT')) return '状态已变化，请刷新后重试'
  if (upper.endsWith('_INVALID')) return '当前操作无效，请刷新后重试'
  if (upper.endsWith('_NOT_FOUND')) return '数据不存在或已被删除'
  if (upper.endsWith('_FORBIDDEN')) return '无权限操作'
  if (upper.endsWith('_ERROR')) return '系统异常，请稍后重试'
  if (upper.endsWith('_FAILED')) return '操作失败，请稍后重试'
  return fallback
}

export function formatExceptionType(code: unknown): string {
  const raw = asTrimmedString(code)
  if (!raw) return '未知异常类型'
  return EXCEPTION_TYPE_LABELS[raw] ?? '未知异常类型'
}

export function formatDatabaseTableName(tableName: unknown): string {
  const raw = asTrimmedString(tableName)
  if (!raw) return '未知数据'
  return DATABASE_TABLE_LABELS[raw] ?? '业务数据'
}

export function formatPrintStatus(statusKey?: PrintStatusKey | null, stateLabel?: string | null, errorMessage?: string | null): string {
  const key = asTrimmedString(statusKey)
  if (key && PRINT_STATUS_LABELS[key]) return PRINT_STATUS_LABELS[key]
  const rawLabel = asTrimmedString(stateLabel)
  if (rawLabel && hasChinese(rawLabel) && !looksLikeTechnicalValue(rawLabel)) return rawLabel
  if (asTrimmedString(errorMessage)) return '打印失败，可尝试补打'
  return '打印状态未知'
}

export function formatPrintReason(reason?: string | null): string {
  const raw = asTrimmedString(reason) || 'default'
  return PRINT_REASON_LABELS[raw] ?? '打印任务'
}

export function formatPdaErrorMessage(message: unknown, fallback = '扫码失败，请检查条码或任务状态'): string {
  const raw = asTrimmedString(message)
  if (!raw) return fallback
  if (PDA_ERROR_LABELS[raw]) return PDA_ERROR_LABELS[raw]
  for (const [needle, label] of Object.entries(PDA_ERROR_LABELS)) {
    if (raw.includes(needle)) return label
  }
  if (/^[A-Z][A-Z0-9_]+$/.test(raw)) return formatBackendCode(raw, fallback)
  if (!hasChinese(raw) || looksLikeTechnicalValue(raw)) return fallback
  return raw
}

export function formatErrorMessage(messageOrCode: unknown, fallback = '操作失败，请检查网络或联系管理员'): string {
  const raw = asTrimmedString(messageOrCode)
  if (!raw) return fallback
  const codeLabel = formatBackendCode(raw, '')
  if (codeLabel) return codeLabel
  if (hasChinese(raw) && !looksLikeTechnicalValue(raw)) return raw
  return fallback
}

export function formatTechnicalValue(value: unknown, fallback = '未提供'): string {
  const raw = asTrimmedString(value)
  return raw || fallback
}

export function formatPrinterSource(source?: string | null): string {
  if (source === 'client') return '打印客户端'
  if (source === 'local_desktop') return '本机系统'
  if (source === 'manual') return '手动添加'
  return '手动添加'
}

export function formatPrinterRawMode(mode?: string | null): string {
  return '标签机指令 ZPL'
}
