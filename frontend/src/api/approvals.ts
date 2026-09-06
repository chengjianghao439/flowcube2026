import { payloadClient as apiClient } from './client'
import type { PaginatedData } from '@/types'
import type { ApprovalFlow, ApprovalFlowStep, PendingApproval } from '@/types/approval'

export const listApprovalFlowsApi = (bizType = '') =>
  apiClient.get<ApprovalFlow[]>('/approvals/flows', { params: bizType ? { bizType } : {} })

export const createApprovalFlowApi = (d: {
  bizType: string
  name: string
  minAmount?: number
  maxAmount?: number | null
  isActive?: boolean
  remark?: string
  steps: ApprovalFlowStep[]
}) => apiClient.post<{ id: number }>('/approvals/flows', d)

export const updateApprovalFlowApi = (id: number, d: Partial<{
  name: string
  minAmount?: number
  maxAmount?: number | null
  isActive?: boolean
  remark?: string
  steps?: ApprovalFlowStep[]
}>) => apiClient.put<null>(`/approvals/flows/${id}`, d)

export const deleteApprovalFlowApi = (id: number) => apiClient.delete<null>(`/approvals/flows/${id}`)

export const listPendingApprovalsApi = (p: { page?: number; pageSize?: number } = {}, summary = false) =>
  apiClient.get<PaginatedData<PendingApproval>>('/approvals/pending', { params: p, ...(summary ? {listMode: 'summary' as const} : {}) })
