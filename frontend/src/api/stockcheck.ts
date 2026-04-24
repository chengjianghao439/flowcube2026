import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { StockCheck, CreateCheckParams } from '@/types/stockcheck'
export const getCheckListApi   = (params: object) => client.get<PaginatedData<StockCheck>>('/stockcheck', { params })
export const getCheckDetailApi = (id: number) => client.get<StockCheck>(`/stockcheck/${id}`)
export const createCheckApi    = (data: CreateCheckParams) => client.post<{ id: number }>('/stockcheck', data)
export const updateCheckItemsApi = (id: number, items: { id: number; actualQty: number }[]) => client.put<null>(`/stockcheck/${id}/items`, { items })
export const submitCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/submit`)
export const cancelCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/cancel`)
