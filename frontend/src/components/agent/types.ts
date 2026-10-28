export interface AssistantLine {
  productId?: number
  productName: string
  qty: number
  unit?: string
  unitPrice?: number
  unitPriceCents?: number | null
  shortage?: number
  available?: number
  priceSource?: { level?: string | null; source?: string; name?: string }
}
export interface AssistantCandidate {
  id: number | string
  title: string
  subtitle?: string
  details?: { label: string; value: string | number }[]
}
export interface AssistantAccount { id: number; name: string }
export interface AssistantAllocation {
  recordId: number
  orderNo: string
  amountCents: number
  balanceBeforeCents: number
  settledAfter?: boolean
}
export interface AssistantPreview {
  title?: string
  confirmLabel?: string
  customer?: { id?: number; name: string }
  warehouseName?: string
  orderNo?: string
  orderId?: number
  receiptId?: number
  receiptNo?: string
  totalCents?: number
  totalRemain?: number
  amountCents?: number
  paymentDate?: string
  expiresAt?: string
  lines?: AssistantLine[]
  drafts?: { supplierName?: string; warehouseName?: string; lines: AssistantLine[]; totalCents?: number }[]
  account?: AssistantAccount | null
  accounts?: AssistantAccount[]
  allocations?: AssistantAllocation[]
}
export interface AssistantTask {
  id: string
  graph: string
  state: string
  userText?: string
  reply?: string
  preview?: AssistantPreview
  result?: Record<string, unknown>
  candidates?: AssistantCandidate[]
  error?: string | null
  queryOutcome?: 'not_found'
  revision?: number
  confirmationBlocked?: string | null
  previewUncertain?: boolean
  previewStorageError?: string
  createdAt?: string
  updatedAt?: string
}
export type AssistantBusinessPage = 'sale' | 'purchase' | 'inventory' | 'price-change' | 'receivable' | 'payable' | 'approvals' | 'shipping'
export interface AssistantResponse {
  task?: AssistantTask | null
  reply?: string
  error?: string
  preview?: AssistantPreview
  result?: Record<string, unknown>
  candidates?: AssistantCandidate[]
  businessPages?: AssistantBusinessPage[]
}
export interface AssistantMessage { id: number; role: 'user' | 'assistant'; text: string; businessPages?: AssistantBusinessPage[] }
export const TASK_STATE_LABELS: Record<string, string> = {
  CREATED: '准备中', PLANNED: '准备中', CONFIRMED: '待执行', DISAMBIGUATING: '待选择', DRY_RUNNING: '核对中', AWAITING_CONFIRM: '待确认',
  EXECUTING: '执行中', VERIFYING: '回查中', RESULT_UNKNOWN: '待核对', ESCALATED: '待人工核对',
  DONE: '已完成', EXPIRED: '已失效', FAILED_FINAL: '未完成', CANCELLED: '已取消',
}
export const GRAPH_LABELS: Record<string, string> = {
  'A-inventory': '库存查询', 'B-sale-draft': '销售草稿', 'B2-reserve': '销售占库',
  'C-replenishment': '补货建议', 'C-purchase-draft': '采购草稿', 'D-ledger': '客户往来',
  'D-receipt': '登记收款', 'D-settle': '核销分配', 'E-stuck': '作业卡点', 'F-briefing': '经营简报', 'G-chat': '极序交流',
}

/** 仅展示安全视图内已有事实；查询未找到不能替代写操作失败。 */
export function taskHistoryStatus(task: AssistantTask) {
  if (task.state === 'FAILED_FINAL' && ['A-inventory', 'D-ledger'].includes(task.graph) && task.queryOutcome === 'not_found') return '未找到'
  if (task.state === 'AWAITING_CONFIRM' && (task.previewUncertain || task.previewStorageError || task.confirmationBlocked)) return '确认已暂停'
  return TASK_STATE_LABELS[task.state] || '待核对'
}
export function taskNeedsRecovery(task: AssistantTask) {
  return ['CONFIRMED', 'EXECUTING', 'VERIFYING', 'RESULT_UNKNOWN', 'ESCALATED'].includes(task.state)
    || (task.state === 'AWAITING_CONFIRM' && Boolean(task.previewUncertain || task.previewStorageError || task.confirmationBlocked))
}
const historyText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
export function taskHistoryTitle(task: AssistantTask) {
  const subject = historyText(task.preview?.customer?.name) || historyText(task.preview?.orderNo)
    || historyText(task.result?.product) || historyText(task.result?.orderNo) || historyText(task.userText)
  const stage = task.graph === 'D-receipt' ? '第1段' : task.graph === 'D-settle' ? '第2段' : undefined
  const receiptNo = historyText(task.result?.receiptNo) || historyText(task.preview?.receiptNo)
  return [GRAPH_LABELS[task.graph] || '业务', subject, stage, receiptNo].filter(Boolean).join(' · ')
}

/** 只将当前可见记录中唯一、显式的第二段 ID 组成展示组；不按名称、金额或时间猜测。 */
export function taskHistoryGroups(tasks: AssistantTask[]): AssistantTask[][] {
  const pairs = new Map<string, AssistantTask[]>()
  for (const receipt of tasks.filter(t => t.graph === 'D-receipt' && typeof t.result?.stage2TaskId === 'string')) {
    const settle = tasks.find(t => t.graph === 'D-settle' && t.id === receipt.result?.stage2TaskId)
    if (!settle || tasks.filter(t => t.graph === 'D-receipt' && t.result?.stage2TaskId === settle.id).length !== 1) continue
    const firstReceiptId = receipt.result?.receiptId
    const secondReceiptId = settle.preview?.receiptId ?? settle.result?.receiptId
    if (firstReceiptId != null && secondReceiptId != null && firstReceiptId !== secondReceiptId) continue
    const pair = [receipt, settle]
    pairs.set(receipt.id, pair); pairs.set(settle.id, pair)
  }
  const shown = new Set<string>()
  return tasks.flatMap(task => {
    if (shown.has(task.id)) return []
    const group = pairs.get(task.id) || [task]
    group.forEach(row => shown.add(row.id))
    return [group]
  })
}
