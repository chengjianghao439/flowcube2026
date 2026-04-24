import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { SaleOrder, CreateSaleParams, UpdateSaleParams } from '@/types/sale'
export const getSaleListApi    = (params: object) => client.get<PaginatedData<SaleOrder>>('/sale', { params })
export const getSaleDetailApi  = (id: number) => client.get<SaleOrder>(`/sale/${id}`)
export const createSaleApi     = (data: CreateSaleParams) => client.post<{ id: number; orderNo: string }>('/sale', data)
export const updateSaleApi     = ({ id, ...data }: UpdateSaleParams) => client.put<null>(`/sale/${id}`, data)
export const reserveSaleApi    = (id: number) => client.post<null>(`/sale/${id}/reserve`)
export const releaseSaleApi    = (id: number) => client.post<null>(`/sale/${id}/release`)
export const shipSaleApi       = (id: number) => client.post<null>(`/sale/${id}/ship`)
export const cancelSaleApi     = (id: number) => client.post<null>(`/sale/${id}/cancel`)
export const deleteSaleApi     = (id: number) => client.delete<null>(`/sale/${id}`)
