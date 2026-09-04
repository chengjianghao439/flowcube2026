import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { Pagination } from '@/types'

export interface PaymentRecord { id:number; type:1|2; typeName:string; orderNo:string; partyName:string; totalAmount:number; paidAmount:number; balance:number; status:1|2|3; statusName:string; confirmStatus?:0|1; confirmedByName?:string|null; confirmedAt?:string|null; dueDate?:string; remark?:string; createdAt:string }
export interface PaymentEntry { id:number; amount:number; paymentDate:string; method?:string; remark?:string; operatorName:string; createdAt:string }
export interface PaymentSummary { totalAmount:number; paidAmount:number; balance:number }
export interface SettlementDetail {
  record: PaymentRecord
  lines: Array<{ taskNo:string; productName:string; articleNumber?:string|null; putawayQty:number; unitPrice:number; amount:number }>
  returns: Array<{ returnNo:string; amount:number }>
}
export const getPaymentsApi  = (p:object) => client.get<{list:PaymentRecord[];pagination:Pagination;summary:PaymentSummary}>('/payments', {params:p})
// 手工建账款（POST /api/payments）没有前端封装：全站没有任何页面调用它，留着的
// createPaymentApi 是死代码，已于 2026-07-27 删除。后端接口仍在（迁移 145 修好了它
// 从建成起就必然 500 的 order_id 问题），要做「手工记账」入口时从这里补回封装即可。
// 登记付款/收款也是「改钱」，带 X-Request-Key 幂等：连点两次/断网重试不重复登记（与核销一致）
export const payApi          = (id:number, d:object, requestKey:string) =>
  client.post<unknown>(`/payments/${id}/pay`, d, { headers: withRequestKeyHeaders(requestKey) })
export const getEntriesApi   = (id:number) => client.get<PaymentEntry[]>(`/payments/${id}/entries`)
/** 财务确认应付结算金额（确认后才可登记付款） */
export const confirmPaymentApi = (id:number) => client.post<{id:number;confirmStatus:1}>(`/payments/${id}/confirm`)
export const getSettlementDetailApi = (id:number) => client.get<SettlementDetail>(`/payments/${id}/settlement-detail`)

// ── 账龄分析 ──────────────────────────────────────────────────────────────────

export interface AgingBucket { key:string; label:string; count:number; amount:number }
export interface AgingParty { partyName:string; count:number; amount:number; overdueAmount:number; maxOverdueDays:number }
export interface AgingSide {
  dueDistribution?: AgingBucket[]
  buckets: AgingBucket[]
  total: number; totalCount: number
  overdueAmount: number; overdueCount: number
  topParties: AgingParty[]
}
export interface AgingReport { asOf: string; receivable: AgingSide; payable: AgingSide }

/** 应收/应付账龄（as-of 今天，跨结算方式汇总全量敞口） */
export const getAgingApi = (topLimit = 8) =>
  client.get<AgingReport>('/payments/aging', { params: { topLimit } })

// ── 收付款单与核销 ────────────────────────────────────────────────────────────

/** 一笔实际汇款。settledAmount 已核销、balance 剩余可核销（>0 即为预收/预付款） */
export interface PaymentReceipt {
  id: number
  receiptNo: string
  type: 1 | 2
  typeName: string
  partyName: string
  amount: number
  settledAmount: number
  balance: number
  status: 1 | 2 | 3
  statusName: string
  paymentDate: string
  method?: string | null
  accountId?: number | null
  accountName?: string | null
  remark?: string | null
  operatorName?: string | null
  createdAt: string
}

/** 这笔汇款核销到了哪些账款 */
export interface ReceiptSettlement {
  entryId: number
  recordId: number
  orderNo: string
  amount: number
  orderTotal: number
  orderPaid: number
  orderBalance: number
  orderStatus: 1 | 2 | 3
  createdAt: string
}

/** 核销目标二选一：recordId 直接核账款（现结），statementId 核对账单（月结） */
export type ReceiptAllocation =
  | { recordId: number; amount: number }
  | { statementId: number; amount: number }

export const getReceiptsApi = (p: object) =>
  client.get<{ list: PaymentReceipt[]; summary: { amount:number; settledAmount:number; balance:number }; pagination: unknown }>('/payments/receipts', { params: p })

export const getReceiptDetailApi = (id: number) =>
  client.get<PaymentReceipt & { settlements: ReceiptSettlement[] }>(`/payments/receipts/${id}`)

/** 新建汇款单并同时核销；allocations 为空表示先挂账，之后再核销 */
export const createReceiptApi = (d: {
  type: 1 | 2; partyName: string; amount: number; paymentDate: string
  method?: string; accountId: number; remark?: string; allocations: ReceiptAllocation[]
}, requestKey: string) =>
  client.post<{ id:number; receiptNo:string; settledAmount:number; balance:number }>(
    '/payments/receipts', d, { headers: withRequestKeyHeaders(requestKey) },
  )

/** 用某张汇款单的剩余余额继续核销 */
export const settleReceiptApi = (id: number, allocations: ReceiptAllocation[], requestKey: string) =>
  client.post<{ id:number; receiptNo:string; settledAmount:number; balance:number }>(
    `/payments/receipts/${id}/settle`, { allocations }, { headers: withRequestKeyHeaders(requestKey) },
  )

// ── 汇总对账单（月结）─────────────────────────────────────────────────────────

export interface ReconciliationStatement {
  id: number
  statementNo: string
  type: 1 | 2
  partyName: string
  periodStart?: string | null
  periodEnd?: string | null
  totalAmount: number
  settledAmount: number
  balance: number
  status: 1 | 2 | 3
  statusName: string
  itemCount?: number
  confirmedByName?: string | null
  confirmedAt?: string | null
  remark?: string | null
  operatorName?: string | null
  createdAt: string
}

export interface StatementItem {
  recordId: number
  orderNo: string
  totalAmount: number
  paidAmount: number
  balance: number
  status: 1 | 2 | 3
  dueDate?: string | null
  createdAt: string
}

export const getStatementsApi = (p: object) =>
  client.get<{ list: ReconciliationStatement[]; pagination: unknown }>('/payments/statements', { params: p })

/** 某往来方在期间内、尚未进过任何对账单的月结账款 */
export const getStatementCandidatesApi = (p: { type:number; partyName:string; startDate?:string; endDate?:string }) =>
  client.get<StatementItem[]>('/payments/statements/candidates', { params: p })

export const getStatementDetailApi = (id: number) =>
  client.get<ReconciliationStatement & { items: StatementItem[] }>(`/payments/statements/${id}`)

export const createStatementApi = (d: {
  type: 1 | 2; partyName: string; periodStart?: string; periodEnd?: string
  recordIds: number[]; remark?: string
}) => client.post<{ id:number; statementNo:string }>('/payments/statements', d)

export const confirmStatementApi = (id: number) => client.post<unknown>(`/payments/statements/${id}/confirm`)
export const unlockStatementApi  = (id: number) => client.post<unknown>(`/payments/statements/${id}/unlock`)
export const removeStatementItemApi = (id: number, recordId: number) =>
  client.delete<unknown>(`/payments/statements/${id}/items/${recordId}`)
