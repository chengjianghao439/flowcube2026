import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'
import type { SaleOrder, CreateSaleParams, UpdateSaleParams, AdjustSaleResult, ReservePreview, ReserveItemOverride, ShipItemRequest } from '@/types/sale'
export const getSaleListApi    = (params: object, summary = false) => client.get<PaginatedData<SaleOrder> & { statusCounts?: Record<string, number> }>('/sale', { params, ...(summary ? { listMode: 'summary' as const } : {}) })
export const getSaleDetailApi  = (id: number) => client.get<SaleOrder>(`/sale/${id}`)
export const getSaleReservePreviewApi = (id: number) => client.get<ReservePreview>(`/sale/${id}/reserve-preview`)
export const createSaleApi     = (data: CreateSaleParams, requestKey?: string) =>
  client.post<{ id: number; orderNo: string }>('/sale', data, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const updateSaleApi     = ({ id, ...data }: UpdateSaleParams) => client.put<null>(`/sale/${id}`, data)
export const adjustSaleApi     = ({ id, ...data }: UpdateSaleParams, requestKey?: string) => client.put<AdjustSaleResult>(`/sale/${id}/adjust`, data, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const reserveSaleApi    = (id: number, items?: ReserveItemOverride[], confirmCreditOverride?: boolean, requestKey?: string) =>
  client.post<null>(`/sale/${id}/reserve`, { ...(items?.length ? { items } : {}), ...(confirmCreditOverride ? { confirmCreditOverride: true } : {}) }, { skipGlobalError: true, ...(requestKey ? { headers: withRequestKeyHeaders(requestKey) } : {}) })
export const releaseSaleApi    = (id: number, items?: ReserveItemOverride[], requestKey?: string) =>
  client.post<null>(`/sale/${id}/release`, items?.length ? { items } : {}, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
// items 为空/不传 = 发全部未派发数量；传了 = 按明细及数量分批发货
export const shipSaleApi       = (id: number, items?: ShipItemRequest[], requestKey?: string) =>
  client.post<null>(`/sale/${id}/ship`, items?.length ? { items } : {}, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const cancelSaleApi     = (id: number, requestKey?: string) => client.post<null>(`/sale/${id}/cancel`, {}, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const deleteSaleApi     = (id: number, requestKey?: string) => client.delete<null>(`/sale/${id}`, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
