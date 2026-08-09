import { payloadClient as apiClient } from './client'
import type {
  Account, CreateAccountParams, UpdateAccountParams,
  Voucher, GenerateStats, ReconciliationItem, CreateManualVoucherParams,
  TrialBalance, AccountLedger, IncomeStatement, BalanceSheet, CashFlow,
  Invoice, CreateInvoiceParams, AccountingPeriod,
} from '@/types/accounting'

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
  apiClient.get<{ items: ReconciliationItem[] }>(`${VBASE}/reconciliation`)

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
