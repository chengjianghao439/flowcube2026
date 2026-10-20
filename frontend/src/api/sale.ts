import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'
import type { SaleOrder, CreateSaleParams, UpdateSaleParams, AdjustSaleResult, ReservePreview, ReserveItemOverride, ShipItemRequest } from '@/types/sale'
import type { SaleReorderSource } from '@/types/sale-reorder'
import type { CommercialBody } from '@/types/sale-commercial'
export const getSaleListApi    = (params: object, summary = false, signal?: AbortSignal) => client.get<PaginatedData<SaleOrder> & { statusCounts?: Record<string, number> }>('/sale', { params, signal, ...(summary ? { listMode: 'summary' as const } : {}) })
export const getSaleDetailApi  = (id: number) => client.get<SaleOrder>(`/sale/${id}`)
export const getSaleReorderSourceApi = (id: number, config?: Parameters<typeof client.get>[1]) => client.get<SaleReorderSource>(`/sale/${id}/reorder-source`, config)
export const getSaleReservePreviewApi = (id: number) => client.get<ReservePreview>(`/sale/${id}/reserve-preview`)
export const createSaleApi     = (data: CreateSaleParams | CommercialBody, requestKey?: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<{ id: number; orderNo: string }>('/sale', data, config || requestKey ? { ...config, ...(requestKey ? { headers: { ...config?.headers, ...withRequestKeyHeaders(requestKey) } } : {}) } : undefined)
export const updateSaleApi     = ({ id, ...data }: UpdateSaleParams, requestKey?: string) => client.put<null>(`/sale/${id}`, data, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const adjustSaleApi     = ({ id, ...data }: UpdateSaleParams, requestKey?: string) => client.put<AdjustSaleResult>(`/sale/${id}/adjust`, data, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const reserveSaleApi    = (id: number, items?: ReserveItemOverride[], requestKey?: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<null>(`/sale/${id}/reserve`, { ...(items?.length ? { items } : {}) }, { ...config, skipGlobalError: true, ...(requestKey ? { headers: withRequestKeyHeaders(requestKey, config?.headers as Record<string,string> | undefined) } : {}) })
export const releaseSaleApi    = (id: number, items?: ReserveItemOverride[], requestKey?: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<null>(`/sale/${id}/release`, items?.length ? { items } : {}, { ...config, skipGlobalError:true, ...(requestKey ? { headers: withRequestKeyHeaders(requestKey, config?.headers as Record<string,string> | undefined) } : {}) })
// items 为空/不传 = 发全部未派发数量；传了 = 按明细及数量分批发货
export const shipSaleApi       = (id: number, items?: ShipItemRequest[], requestKey?: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<null | {tasks:{taskId:number;taskNo:string;warehouseName:string}[];partial:boolean;remaining:number}>(`/sale/${id}/ship`, items?.length ? { items } : {}, { ...config, skipGlobalError:true, ...(requestKey ? { headers: withRequestKeyHeaders(requestKey, config?.headers as Record<string,string> | undefined) } : {}) })
export const cancelSaleApi = (id: number, requestKey?: string, changeReason?: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<null>(`/sale/${id}/cancel`, changeReason ? { changeReason } : {}, { ...config, skipGlobalError:true,
    ...(requestKey ? { headers:withRequestKeyHeaders(requestKey, config?.headers as Record<string,string> | undefined) } : {}) })
export const deleteSaleApi     = (id: number, requestKey?: string) => client.delete<null>(`/sale/${id}`, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
