import { payloadClient as apiClient } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'
import type { PurchaseRequisition, CreateRequisitionParams, ConvertLine } from '@/types/purchase-requisition'

export const listRequisitionsApi = (p: Record<string, unknown>) =>
  apiClient.get<PaginatedData<PurchaseRequisition>>('/purchase-requisitions', { params: p })

export const getRequisitionApi = (id: number) =>
  apiClient.get<PurchaseRequisition>(`/purchase-requisitions/${id}`)

export const createRequisitionApi = (d: CreateRequisitionParams, config?: Parameters<typeof apiClient.post>[2]) =>
  apiClient.post<{ id: number; requisitionNo: string }>('/purchase-requisitions', d, config)

export const updateRequisitionApi = (id: number, d: Partial<CreateRequisitionParams>) =>
  apiClient.put<null>(`/purchase-requisitions/${id}`, d)

export const submitRequisitionApi = (id: number) => apiClient.post<unknown>(`/purchase-requisitions/${id}/submit`)
export const withdrawRequisitionApi = (id: number) => apiClient.post<unknown>(`/purchase-requisitions/${id}/withdraw`)
export const cancelRequisitionApi = (id: number) => apiClient.post<unknown>(`/purchase-requisitions/${id}/cancel`)
export const approveRequisitionApi = (id: number) => apiClient.post<unknown>(`/purchase-requisitions/${id}/approve`)
export const rejectRequisitionApi = (id: number, reason: string) => apiClient.post<unknown>(`/purchase-requisitions/${id}/reject`, { reason })

// 转采购单：带 X-Request-Key 幂等（后端 beginOperationRequest 对同 key 重放直接返回原结果）。
// 请求键**由调用方集中管理**（见 form.tsx 的 convertGuard）：同一次「转单意图」内保持稳定，
// 只在拿到确定结果后才轮换。此前每次调用都新建 key —— 「后台已成功、但客户端没收到答复」时
// 用户再点一次就会用新 key 被当成新请求，**重复建采购单并二次累加 converted_qty**。
export const convertRequisitionApi = (id: number, lines: ConvertLine[], requestKey: string) =>
  apiClient.post<{ requisitionId: number; createdOrders: Array<{ id: number; orderNo: string; supplierName: string; itemCount: number }>; completed: boolean }>(
    `/purchase-requisitions/${id}/convert`,
    { lines },
    { headers: withRequestKeyHeaders(requestKey) },
  )
