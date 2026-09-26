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

// ── 手工应付（无单据应付）────────────────────────────────────────────────────
// 手工建账款（POST /api/payments）在 2026-07-27 曾因无任何页面调用而删掉封装；2026-09-26
// 一致性审查任务 3b 补回「新建应付账款」入口时一并恢复。手工**应付**必须逐笔指定借方科目，
// 否则这笔负债永远入不了账、只能挂在勾稽的「未分类」里（见后端 createManual）。
export interface DebitAccountOption { code:string; name:string; category:number }

/** 手工应付可选的借方科目：默认账套下启用、可记账的明细科目 */
export const getDebitAccountOptionsApi = () =>
  client.get<DebitAccountOption[]>('/payments/debit-account-options')

export interface CreatePaymentParams {
  type: 1 | 2
  orderNo: string
  partyName: string
  totalAmount: number
  /** 1现结（落现结账款页）2月结（落月结对账页）；决定这笔账款出现在哪个列表 */
  settlementType: 1 | 2
  /** 不传则按结算方式推算：现结=当天，月结=当天+30 天 */
  dueDate?: string
  remark?: string
  /** 仅 type=1 有效：手工应付必填 */
  debitAccountCode?: string
}

/**
 * 手工建账款。改钱路径，带 X-Request-Key 幂等：连点两次/断网重试不会落两条。
 * skipGlobalError：校验错误（科目非法、汇总科目、单号为空）要留在录入弹窗里逐条显示，
 * 而不是弹个一闪而过的 toast——财务得看清是哪一项不合格才能改。
 */
export const createPaymentApi = (d: CreatePaymentParams, requestKey: string) =>
  client.post<{ id:number; settlementType:number }>(
    '/payments', d, { headers: withRequestKeyHeaders(requestKey), skipGlobalError: true },
  )
// 登记付款/收款也是「改钱」，带 X-Request-Key 幂等：连点两次/断网重试不重复登记（与核销一致）
// config 用于调用点自行接管错误处理：期间已结账时后端 409，业务入口要弹补录申请而不是全局 toast
export const payApi          = (id:number, d:object, requestKey:string, config?: { skipGlobalError?: boolean }) =>
  client.post<unknown>(`/payments/${id}/pay`, d, { ...config, headers: withRequestKeyHeaders(requestKey) })
export const getEntriesApi   = (id:number) => client.get<PaymentEntry[]>(`/payments/${id}/entries`)
/** 财务确认应付结算金额（确认后才可登记付款） */
export const confirmPaymentApi = (id:number) => client.post<{id:number;confirmStatus:1}>(`/payments/${id}/confirm`)
export const getSettlementDetailApi = (id:number) => client.get<SettlementDetail>(`/payments/${id}/settlement-detail`, { skipGlobalError: true })

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
  partyId?: number | null
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

/**
 * 新建汇款单并同时核销；allocations 为空表示先挂账，之后再核销。
 * backfillReason 有值＝这次不是记账，而是把原请求提交成一张跨期补录申请（业务日期落在已结账期间时），
 * 必须复用**同一个 requestKey**，否则同一笔汇款会被申请两遍。返回体是申请单时含 applicationNo。
 */
export const createReceiptApi = (d: {
  type: 1 | 2; partyId?: number; partyName: string; amount: number; paymentDate: string
  method?: string; accountId: number; remark?: string; allocations: ReceiptAllocation[]
}, requestKey: string, backfillReason?: string, config?: { skipGlobalError?: boolean }) =>
  client.post<{ id:number; receiptNo:string; settledAmount:number; balance:number; applicationNo?:string }>(
    '/payments/receipts',
    backfillReason ? { ...d, backfillRequest: true, backfillReason } : d,
    { ...config, headers: withRequestKeyHeaders(requestKey) },
  )

/** 用某张汇款单的剩余余额继续核销（backfillReason 见 createReceiptApi） */
export const settleReceiptApi = (id: number, allocations: ReceiptAllocation[], requestKey: string, backfillReason?: string, config?: { skipGlobalError?: boolean }) =>
  client.post<{ id:number; receiptNo:string; settledAmount:number; balance:number; applicationNo?:string }>(
    `/payments/receipts/${id}/settle`,
    backfillReason ? { allocations, backfillRequest: true, backfillReason } : { allocations },
    { ...config, headers: withRequestKeyHeaders(requestKey) },
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

/** 待建对账单的原始账款；与已建对账单明细的 recordId 分开。 */
export interface StatementCandidate {
  id: number
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
  client.get<StatementCandidate[]>('/payments/statements/candidates', { params: p })

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
