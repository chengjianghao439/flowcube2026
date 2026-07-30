import { payloadClient as apiClient } from './client'
import { withRequestKeyHeaders, createRequestKey } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'
import type { PurchaseRequisition, CreateRequisitionParams, ConvertLine } from '@/types/purchase-requisition'

export const listRequisitionsApi = (p: Record<string, unknown>) =>
  apiClient.get<PaginatedData<PurchaseRequisition>>('/purchase-requisitions', { params: p })

export const getRequisitionApi = (id: number) =>
  apiClient.get<PurchaseRequisition>(`/purchase-requisitions/${id}`)

export const createRequisitionApi = (d: CreateRequisitionParams) =>
  apiClient.post<{ id: number; requisitionNo: string }>('/purchase-requisitions', d)

export const updateRequisitionApi = (id: number, d: Partial<CreateRequisitionParams>) =>
  apiClient.put<null>(`/purchase-requisitions/${id}`, d)

export const submitRequisitionApi = (id: number) => apiClient.post<unknown>(`/purchase-requisitions/${id}/submit`)
export const withdrawRequisitionApi = (id: number) => apiClient.post<unknown>(`/purchase-requisitions/${id}/withdraw`)
export const cancelRequisitionApi = (id: number) => apiClient.post<unknown>(`/purchase-requisitions/${id}/cancel`)
export const approveRequisitionApi = (id: number) => apiClient.post<unknown>(`/purchase-requisitions/${id}/approve`)
export const rejectRequisitionApi = (id: number, reason: string) => apiClient.post<unknown>(`/purchase-requisitions/${id}/reject`, { reason })

// 转采购单：带 X-Request-Key 幂等（后端 beginOperationRequest 对同 key 重放直接返回原结果）
export const convertRequisitionApi = (id: number, lines: ConvertLine[]) =>
  apiClient.post<{ requisitionId: number; createdOrders: Array<{ id: number; orderNo: string; supplierName: string; itemCount: number }>; completed: boolean }>(
    `/purchase-requisitions/${id}/convert`,
    { lines },
    { headers: withRequestKeyHeaders(createRequestKey()) },
  )
