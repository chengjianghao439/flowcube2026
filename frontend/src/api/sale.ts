import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'
import type { SaleOrder, CreateSaleParams, UpdateSaleParams, AdjustSaleResult } from '@/types/sale'
export const getSaleListApi    = (params: object) => client.get<PaginatedData<SaleOrder>>('/sale', { params })
export const getSaleDetailApi  = (id: number) => client.get<SaleOrder>(`/sale/${id}`)
export const createSaleApi     = (data: CreateSaleParams, requestKey?: string) =>
  client.post<{ id: number; orderNo: string }>('/sale', data, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const updateSaleApi     = ({ id, ...data }: UpdateSaleParams) => client.put<null>(`/sale/${id}`, data)
export const adjustSaleApi     = ({ id, ...data }: UpdateSaleParams) => client.put<AdjustSaleResult>(`/sale/${id}/adjust`, data)
export const reserveSaleApi    = (id: number) => client.post<null>(`/sale/${id}/reserve`, {}, { skipGlobalError: true })
export const releaseSaleApi    = (id: number) => client.post<null>(`/sale/${id}/release`)
// itemIds 为空/不传 = 发全部未派发行；传了 = 只发选中的行（分批发货）
export const shipSaleApi       = (id: number, itemIds?: number[]) => client.post<null>(`/sale/${id}/ship`, itemIds?.length ? { itemIds } : {})
export const cancelSaleApi     = (id: number) => client.post<null>(`/sale/${id}/cancel`)
export const deleteSaleApi     = (id: number) => client.delete<null>(`/sale/${id}`)
