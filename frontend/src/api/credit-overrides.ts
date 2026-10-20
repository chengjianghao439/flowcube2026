import { withRequestKeyHeaders } from '@/lib/requestKey'
import { payloadClient as apiClient } from './client'
import type { PaginatedData } from '@/types'
import type { CreditOverride, CreateCreditOverrideParams } from '@/types/credit-override'

export const listCreditOverridesApi = (p: Record<string, unknown>) =>
  apiClient.get<PaginatedData<CreditOverride>>('/credit-overrides', { params: p })

export const getCreditOverrideApi = (id: number) =>
  apiClient.get<CreditOverride>(`/credit-overrides/${id}`)

export const createCreditOverrideApi = (d: CreateCreditOverrideParams) =>
  apiClient.post<{ id: number; overrideNo: string; overAmount: number }>('/credit-overrides', d)

export const submitCreditOverrideApi = (id: number) => apiClient.post<unknown>(`/credit-overrides/${id}/submit`)
export const cancelCreditOverrideApi = (id: number) => apiClient.post<unknown>(`/credit-overrides/${id}/cancel`)
export type CreditApprovalIntent = { id: number; expectedTaskId: number; reason?: string }
export const approveCreditOverrideApi = ({id,...body}: CreditApprovalIntent) => apiClient.post<unknown>(`/credit-overrides/${id}/approve`, body, { headers: withRequestKeyHeaders(`credit-approve-${id}-${body.expectedTaskId}`) })
export const rejectCreditOverrideApi = ({id,...body}: CreditApprovalIntent) => apiClient.post<unknown>(`/credit-overrides/${id}/reject`, body, { headers: withRequestKeyHeaders(`credit-reject-${id}-${body.expectedTaskId}`) })
