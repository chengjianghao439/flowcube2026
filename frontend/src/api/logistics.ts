import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { LogisticsWaybill, TrackEvent, FreightBill, FreightSettlement } from '@/types/logistics'

// ─── 运单 ─────────────────────────────────────────────────────────────────────
export const getWaybillsApi     = (params: object)                       => client.get<PaginatedData<LogisticsWaybill>>('/logistics', { params })
export const getWaybillDetailApi = (id: number)                          => client.get<LogisticsWaybill>(`/logistics/${id}`)
export const getWaybillTrackApi  = (id: number)                          => client.get<TrackEvent[]>(`/logistics/${id}/track`)
export const setWaybillTrackingApi = (id: number, trackingNo: string)    => client.put<LogisticsWaybill>(`/logistics/${id}/tracking`, { trackingNo })
export const retryWaybillApi     = (id: number)                          => client.post<LogisticsWaybill>(`/logistics/${id}/retry`, {})
export const voidWaybillApi      = (id: number, reason?: string)         => client.post<LogisticsWaybill>(`/logistics/${id}/void`, { reason })

// ─── 运费对账 ─────────────────────────────────────────────────────────────────
export const getFreightBillsApi   = (params: object)                     => client.get<PaginatedData<FreightBill>>('/logistics/freight/bills', { params })
export const createFreightBillApi = (data: object)                       => client.post<{ id: number }>('/logistics/freight/bills', data)
export const getFreightSettlementsApi = (params: object)                 => client.get<PaginatedData<FreightSettlement>>('/logistics/freight/settlements', { params })
export const generateFreightSettlementApi = (carrierId: number, billPeriod: string) =>
  client.post<FreightSettlement>('/logistics/freight/settlements', { carrierId, billPeriod })
