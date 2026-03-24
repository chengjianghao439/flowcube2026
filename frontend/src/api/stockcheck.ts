import client from './client'
import type { ApiResponse, PaginatedData } from '@/types'
import type { StockCheck, CreateCheckParams } from '@/types/stockcheck'
export const getCheckListApi   = (params: object) => client.get<ApiResponse<PaginatedData<StockCheck>>>('/stockcheck', { params })
export const getCheckDetailApi = (id: number) => client.get<ApiResponse<StockCheck>>(`/stockcheck/${id}`)
export const createCheckApi    = (data: CreateCheckParams) => client.post<ApiResponse<{ id: number }>>('/stockcheck', data)
export const updateCheckItemsApi = (id: number, items: { id: number; actualQty: number }[]) => client.put<ApiResponse<null>>(`/stockcheck/${id}/items`, { items })
export const submitCheckApi    = (id: number) => client.post<ApiResponse<null>>(`/stockcheck/${id}/submit`)
export const cancelCheckApi    = (id: number) => client.post<ApiResponse<null>>(`/stockcheck/${id}/cancel`)
