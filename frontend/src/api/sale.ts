import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'
import type { SaleOrder, CreateSaleParams, UpdateSaleParams, AdjustSaleResult, ReservePreview, ReserveItemOverride } from '@/types/sale'
export const getSaleListApi    = (params: object) => client.get<PaginatedData<SaleOrder>>('/sale', { params })
export const getSaleDetailApi  = (id: number) => client.get<SaleOrder>(`/sale/${id}`)
export const getSaleReservePreviewApi = (id: number) => client.get<ReservePreview>(`/sale/${id}/reserve-preview`)
export const createSaleApi     = (data: CreateSaleParams, requestKey?: string) =>
  client.post<{ id: number; orderNo: string }>('/sale', data, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const updateSaleApi     = ({ id, ...data }: UpdateSaleParams) => client.put<null>(`/sale/${id}`, data)
export const adjustSaleApi     = ({ id, ...data }: UpdateSaleParams) => client.put<AdjustSaleResult>(`/sale/${id}/adjust`, data)
export const reserveSaleApi    = (id: number, items?: ReserveItemOverride[], confirmCreditOverride?: boolean, requestKey?: string) =>
  client.post<null>(`/sale/${id}/reserve`, { ...(items?.length ? { items } : {}), ...(confirmCreditOverride ? { confirmCreditOverride: true } : {}) }, { skipGlobalError: true, ...(requestKey ? { headers: withRequestKeyHeaders(requestKey) } : {}) })
export const releaseSaleApi    = (id: number, items?: ReserveItemOverride[], requestKey?: string) =>
  client.post<null>(`/sale/${id}/release`, items?.length ? { items } : {}, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
// itemIds 为空/不传 = 发全部未派发行；传了 = 只发选中的行（分批发货）
export const shipSaleApi       = (id: number, itemIds?: number[], requestKey?: string) =>
  client.post<null>(`/sale/${id}/ship`, itemIds?.length ? { itemIds } : {}, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const cancelSaleApi     = (id: number) => client.post<null>(`/sale/${id}/cancel`)
export const deleteSaleApi     = (id: number) => client.delete<null>(`/sale/${id}`)
