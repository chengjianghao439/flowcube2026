import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'
import type { PurchaseOrder, CreatePurchaseParams } from '@/types/purchase'
export const getPurchaseListApi = (params: object) => client.get<PaginatedData<PurchaseOrder>>('/purchase', { params })
export const getPurchaseDetailApi = (id: number) => client.get<PurchaseOrder>(`/purchase/${id}`)
export const createPurchaseApi = (data: CreatePurchaseParams, requestKey?: string) =>
  client.post<{ id: number; orderNo: string }>('/purchase', data, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const updatePurchaseApi = (id: number, data: CreatePurchaseParams) => client.put<PurchaseOrder>(`/purchase/${id}`, data)
export const confirmPurchaseApi = (id: number) => client.post<null>(`/purchase/${id}/confirm`)
export const cancelPurchaseApi  = (id: number) => client.post<null>(`/purchase/${id}/cancel`)
export const closePurchaseApi   = (id: number) => client.post<null>(`/purchase/${id}/close`)
