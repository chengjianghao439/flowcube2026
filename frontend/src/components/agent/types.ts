export interface AssistantLine {
  productId?: number
  productName: string
  warehouseName?: string
  qty: number
  reservedQty?: number
  unit?: string
  unitPrice?: number
  unitPriceCents?: number | null
  shortage?: number
  available?: number
  priceSource?: { level?: string; source?: string }
}
interface AssistantCandidate {
  id: number | string
  title: string
  subtitle?: string
  details?: { label: string; value: string | number }[]
}
interface AssistantAccount { id: number; name: string }
interface AssistantAllocation {
  recordId: number
  orderId?: number
  orderNo: string
  amountCents: number
  balanceBeforeCents: number
  settledAfter?: boolean
}
interface AssistantPreview {
  title?: string
  confirmLabel?: string
  customer?: { id?: number; name: string }
  warehouseName?: string
  orderNo?: string
  orderId?: number
  statementNo?: string
  statementBalanceBeforeCents?: number
  receiptId?: number
  receiptNo?: string
  receiptBalanceBeforeCents?: number
  refundNo?: string
  applicationNo?: string
  businessPeriod?: string
  postingMonth?: string
  saleOrderNo?: string
  totalCents?: number
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
  conversationId?: string
  graph: string
  state: string
  userText?: string
  reply?: string
  preview?: AssistantPreview
  result?: Record<string, unknown>
  candidates?: AssistantCandidate[]
  candidateKey?: string
  reviewRequired?: boolean
  error?: string | null
  revision?: number
  createdAt?: string
  updatedAt?: string
}
export interface AssistantResponse {
  task?: AssistantTask | null
  conversationId?: string
  detachTask?: boolean
  keepReferences?: boolean
  historyLookup?: boolean
  historyQuery?: string
  reply?: string
  error?: string
  preview?: AssistantPreview
  result?: Record<string, unknown>
  candidates?: AssistantCandidate[]
}
export interface AssistantMessage { id: number; role: 'user' | 'assistant'; text: string }
export const TASK_STATE_LABELS: Record<string, string> = {
  PAUSED: '待续办', CREATED: '准备中', PLANNED: '准备中', CONFIRMED: '待执行', DISAMBIGUATING: '待选择', DRY_RUNNING: '核对中', AWAITING_CONFIRM: '待确认',
  EXECUTING: '执行中', VERIFYING: '回查中', RESULT_UNKNOWN: '待核对', ESCALATED: '待人工核对',
  DONE: '已完成', EXPIRED: '已失效', FAILED_FINAL: '未完成', CANCELLED: '已作废',
}
export const GRAPH_LABELS: Record<string, string> = {
  'A-inventory': '库存查询', 'B-sale-draft': '销售草稿', 'B2-reserve': '销售占库',
  'C-replenishment': '补货建议', 'C-purchase-draft': '采购草稿', 'D-ledger': '客户往来',
  'D-receipt': '登记收款', 'D-settle': '核销分配', 'E-stuck': '作业卡点', 'F-briefing': '经营简报',
  'K-sequence': '按顺序查询', 'H-workbench': '岗位待办', 'I-returns': '退货卡点', 'J-receipt-status': '收款状态',
  'L-sale-handoff': '销售单交接', 'M-monthly-reconciliation': '月结对账',
  'N-return-finance': '退货后应收与退款', 'P-refund-execute': '退款出账', 'Q-cross-period': '跨月退货和退款', 'R-backfill-action': '退款补录',
}
