import { payloadClient as apiClient } from './client'
import type { PaginatedData } from '@/types'
import type {
  Account, CreateAccountParams, UpdateAccountParams,
  Voucher, GenerateStats, ReconciliationResult, CreateManualVoucherParams,
  TrialBalance, AccountLedger, IncomeStatement, BalanceSheet, CashFlow,
  Invoice, CreateInvoiceParams, AccountingPeriod,
  BackfillApplication, BackfillListQuery, BackfillListResult,
} from '@/types/accounting'

// ── 账套 / 合并报表（文档10 多账套） ──────────────────────────────────
export interface AcctCompany {
  id: number
  code: string
  name: string
  taxNo: string | null
  parentId: number | null
  isGroup: boolean
  currency: string
  startPeriod: string | null
  isActive: boolean
  remark: string | null
}
export interface ConsolidatedBalanceSheet {
  period: string
  asOf: string
  groupId: number
  companies: Array<{ id: number; code: string; name: string }>
  assets: Array<{ code: string; name: string; amount: number }>
  liabilities: Array<{ code: string; name: string; amount: number }>
  equity: Array<{ code: string; name: string; amount: number }>
  assetTotal: number
  liabTotal: number
  equityTotal: number
  liabEquityTotal: number
  balanced: boolean
}
export interface ConsolidatedIncome {
  period: string
  groupId: number
  companies: Array<{ id: number; code: string; name: string }>
  revenue: Array<{ code: string; name: string; amount: number }>
  expenses: Array<{ code: string; name: string; amount: number }>
  revenueTotal: number
  expenseTotal: number
  netProfit: number
}
export const listCompaniesApi = (params?: object) => apiClient.get<PaginatedData<AcctCompany>>('/accounting/companies', { params })
export const createCompanyApi = (data: { code: string; name: string; isGroup?: boolean; parentId?: number | null }) =>
  apiClient.post<{ id: number; code: string }>('/accounting/companies', data)
export const getConsolidatedBalanceSheetApi = (groupId: number, period: string) =>
  apiClient.get<ConsolidatedBalanceSheet>('/accounting/consolidation/balance-sheet', { params: { groupId, period } })
export const getConsolidatedIncomeApi = (groupId: number, period: string) =>
  apiClient.get<ConsolidatedIncome>('/accounting/consolidation/income', { params: { groupId, period } })

const BASE = '/accounting/accounts'

export const getAccountTreeApi = async () => apiClient.get<Account[]>(`${BASE}/tree`)

export const getAccountFlatApi = async (opts?: { onlyLeaf?: boolean; onlyActive?: boolean }) => {
  const q = new URLSearchParams()
  if (opts?.onlyLeaf)   q.set('onlyLeaf', '1')
  if (opts?.onlyActive) q.set('onlyActive', '1')
  const qs = q.toString()
  return apiClient.get<Account[]>(`${BASE}/flat${qs ? `?${qs}` : ''}`)
}

export const createAccountApi = async (d: CreateAccountParams) =>
  apiClient.post<{ id: number; code: string }>(`${BASE}`, d)

export const updateAccountApi = async (id: number, d: UpdateAccountParams) => {
  await apiClient.put(`${BASE}/${id}`, d)
}

export const deleteAccountApi = async (id: number) => {
  await apiClient.delete(`${BASE}/${id}`)
}

export const toggleAccountStatusApi = async (id: number, isActive: boolean) => {
  await apiClient.patch(`${BASE}/${id}/status`, { isActive })
}

// ── 记账凭证 ──────────────────────────────────────────────────────────
const VBASE = '/accounting/vouchers'

export interface VoucherQuery {
  period?: string
  sourceType?: string
  status?: number
  keyword?: string
  page?: number
  pageSize?: number
}

export const getVouchersApi = async (params: VoucherQuery = {}) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)) })
  const qs = q.toString()
  return apiClient.get<{ list: Voucher[]; pagination: { page: number; pageSize: number; total: number } }>(`${VBASE}${qs ? `?${qs}` : ''}`)
}

export const getVoucherApi = async (id: number) => apiClient.get<Voucher>(`${VBASE}/${id}`)

export const generateVouchersApi = async (period?: string | null) =>
  apiClient.post<GenerateStats>(`${VBASE}/generate`, { period: period || null })

export const createManualVoucherApi = async (d: CreateManualVoucherParams) =>
  apiClient.post<{ id: number; voucherNo: string }>(`${VBASE}`, d)

export const reverseVoucherApi = async (id: number) =>
  apiClient.post<{ id: number; voucherNo: string }>(`${VBASE}/${id}/reverse`, {})

export const deleteVoucherApi = async (id: number) => { await apiClient.delete(`${VBASE}/${id}`) }

// ── 会计期间 / 期末结转 ──────────────────────────────────────────────────
export const getPeriodsApi = async () => apiClient.get<AccountingPeriod[]>('/accounting/periods')
export const generateClosingVouchersApi = async (period: string, config?: Parameters<typeof apiClient.post>[2]) =>
  apiClient.post<{ period: string; results: Array<{ kind: string; created?: boolean; updated?: boolean }> }>('/accounting/periods/generate-closing', { period }, config)
export const closePeriodApi = async (period: string, config?: Parameters<typeof apiClient.post>[2]) => apiClient.post<{ period: string }>('/accounting/periods/close', { period }, config)
export const reopenPeriodApi = async (period: string, config?: Parameters<typeof apiClient.post>[2]) => apiClient.post<{ period: string }>('/accounting/periods/reopen', { period }, config)

export const getReconciliationApi = async () =>
  apiClient.get<ReconciliationResult>(`${VBASE}/reconciliation`)

// ── 总账 / 报表（Phase 2） ──────────────────────────────────────────────
export const getTrialBalanceApi = async (period: string) =>
  apiClient.get<TrialBalance>(`/accounting/ledger/trial-balance?period=${period}`)

export const getAccountLedgerApi = async (accountId: number, period: string) =>
  apiClient.get<AccountLedger>(`/accounting/ledger/account/${accountId}?period=${period}`)

export const getIncomeStatementApi = async (period: string) =>
  apiClient.get<IncomeStatement>(`/accounting/reports/income?period=${period}`)

export const getBalanceSheetApi = async (period: string) =>
  apiClient.get<BalanceSheet>(`/accounting/reports/balance-sheet?period=${period}`)

export const getCashFlowApi = async (period: string) =>
  apiClient.get<CashFlow>(`/accounting/reports/cash-flow?period=${period}`)

// ── 发票（Phase 3） ──────────────────────────────────────────────────
const IBASE = '/accounting/invoices'
export interface InvoiceQuery { invoiceType?: number; status?: number; keyword?: string; page?: number; pageSize?: number }

export const getInvoicesApi = async (params: InvoiceQuery = {}) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)) })
  const qs = q.toString()
  return apiClient.get<{ list: Invoice[]; pagination: { page: number; pageSize: number; total: number } }>(`${IBASE}${qs ? `?${qs}` : ''}`)
}
export const createInvoiceApi = async (d: CreateInvoiceParams) => apiClient.post<{ id: number }>(`${IBASE}`, d)
export const updateInvoiceApi = async (id: number, d: Partial<CreateInvoiceParams>) => { await apiClient.put(`${IBASE}/${id}`, d) }
export const changeInvoiceStatusApi = async (id: number, action: 'certify' | 'deduct' | 'redFlush') =>
  apiClient.post<{ status: number }>(`${IBASE}/${id}/status`, { action })
export const deleteInvoiceApi = async (id: number) => { await apiClient.delete(`${IBASE}/${id}`) }

// ── 跨期补录审批（任务 7 第二期） ────────────────────────────────────────
// 申请人提交后只落一张待审批单、一分钱不动账；批准（须他人）并执行才真正记账，
// 调整凭证落在**执行审批日所在期间**（补录当期），不是业务期间。
const BBASE = '/accounting/backfills'

export const getBackfillsApi = async (params: BackfillListQuery = {}) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)) })
  const qs = q.toString()
  return apiClient.get<BackfillListResult>(`${BBASE}${qs ? `?${qs}` : ''}`)
}

export const getBackfillDetailApi = async (id: number) => apiClient.get<BackfillApplication>(`${BBASE}/${id}`)

export const approveBackfillApi = async (id: number, remark?: string) =>
  apiClient.post<BackfillApplication & { voucherError?: string | null }>(`${BBASE}/${id}/approve`, { remark: remark || null })

export const rejectBackfillApi = async (id: number, remark: string) =>
  apiClient.post<BackfillApplication>(`${BBASE}/${id}/reject`, { remark })

/** 撤回（待审批，申请人自己）或作废（已批准但执行不下去，审批侧）；能否作废由后端按状态判 */
export const cancelBackfillApi = async (id: number, reason: string) =>
  apiClient.post<BackfillApplication>(`${BBASE}/${id}/cancel`, { reason })

/** 重试执行「已批准但业务没写进去」的单子；业务已漂移的会再次失败，届时作废重报 */
export const executeBackfillApi = async (id: number) =>
  apiClient.post<BackfillApplication & { voucherError?: string | null }>(`${BBASE}/${id}/execute`, {})

/** 业务已记账、调整凭证没生成出来时的重试入口 */
export const regenerateBackfillVoucherApi = async (id: number) =>
  apiClient.post<BackfillApplication>(`${BBASE}/${id}/regenerate-voucher`, {})
