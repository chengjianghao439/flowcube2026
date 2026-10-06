import { recordIdentityByFields } from './allRecords'
import { payloadClient as apiClient } from './client'
import type { PaginatedData } from '@/types'
import type { ApprovalFlow, ApprovalFlowStep, PendingApproval } from '@/types/approval'
import type { AxiosRequestConfig } from 'axios'

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

const legacyTaskIdentity = recordIdentityByFields('taskId')
const pendingTaskIdentity = (value: unknown) => {
  if (value && typeof value === 'object' && 'entryKey' in value && typeof value.entryKey === 'string' && value.entryKey) return JSON.stringify(['entry', value.entryKey])
  if (value && typeof value === 'object' && 'sourceKind' in value && value.sourceKind === 'document') throw new Error('列表数据不完整，请刷新后重试')
  return legacyTaskIdentity(value)
}
export const listPendingApprovalsApi = (p: { page?: number; pageSize?: number } = {}, mode: boolean | 'paged' = false, config?: AxiosRequestConfig) =>
  apiClient.get<PaginatedData<PendingApproval>>('/approvals/pending', {
    ...config, params: p, ...(mode === 'paged' ? { listMode: 'paged' as const } : mode ? { listMode: 'summary' as const } : {}),
  }, pendingTaskIdentity)
