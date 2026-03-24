import client from './client'
import type { ApiResponse, PaginatedData } from '@/types'
import type { PurchaseOrder, CreatePurchaseParams } from '@/types/purchase'
export const getPurchaseListApi = (params: object) => client.get<ApiResponse<PaginatedData<PurchaseOrder>>>('/purchase', { params })
export const getPurchaseDetailApi = (id: number) => client.get<ApiResponse<PurchaseOrder>>(`/purchase/${id}`)
export const createPurchaseApi = (data: CreatePurchaseParams) => client.post<ApiResponse<{ id: number; orderNo: string }>>('/purchase', data)
export const confirmPurchaseApi = (id: number) => client.post<ApiResponse<null>>(`/purchase/${id}/confirm`)
export const receivePurchaseApi = (id: number) => client.post<ApiResponse<null>>(`/purchase/${id}/receive`)
export const cancelPurchaseApi  = (id: number) => client.post<ApiResponse<null>>(`/purchase/${id}/cancel`)
