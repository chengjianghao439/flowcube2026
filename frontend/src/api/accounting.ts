import { payloadClient as apiClient } from './client'
import type {
  Account, CreateAccountParams, UpdateAccountParams,
  Voucher, GenerateStats, ReconciliationItem, CreateManualVoucherParams,
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

export const getReconciliationApi = async () =>
  apiClient.get<{ items: ReconciliationItem[] }>(`${VBASE}/reconciliation`)
