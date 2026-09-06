import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { LogisticsWaybill, UpdateShipmentParams, TrackEvent, FreightBill, FreightSettlement } from '@/types/logistics'

// ─── 运单 ─────────────────────────────────────────────────────────────────────
export const getWaybillsApi     = (params: object)                       => client.get<PaginatedData<LogisticsWaybill>>('/logistics', { params })
export const getWaybillDetailApi = (id: number)                          => client.get<LogisticsWaybill>(`/logistics/${id}`)
export const getWaybillTrackApi  = (id: number)                          => client.get<TrackEvent[]>(`/logistics/${id}/track`)
export const updateWaybillShipmentApi = (id: number, data: UpdateShipmentParams, config?: Parameters<typeof client.put>[2]) => client.put<LogisticsWaybill>(`/logistics/${id}/shipment`, data, config)
export const setWaybillTrackingApi = (id: number, trackingNo: string, config?: Parameters<typeof client.put>[2]) => client.put<LogisticsWaybill>(`/logistics/${id}/tracking`, { trackingNo }, config)
export const retryWaybillApi     = (id: number, config?: Parameters<typeof client.post>[2]) => client.post<LogisticsWaybill>(`/logistics/${id}/retry`, {}, config)
export const voidWaybillApi      = (id: number, reason?: string, config?: Parameters<typeof client.post>[2]) => client.post<LogisticsWaybill>(`/logistics/${id}/void`, { reason }, config)

// ─── 运费对账 ─────────────────────────────────────────────────────────────────
export const getFreightBillsApi   = (params: object)                     => client.get<PaginatedData<FreightBill>>('/logistics/freight/bills', { params })
export const createFreightBillApi = (data: object, config?: Parameters<typeof client.post>[2]) => client.post<{ id: number }>('/logistics/freight/bills', data, config)
export const getFreightSettlementsApi = (params: object) => client.get<PaginatedData<FreightSettlement>>('/logistics/freight/settlements', { params })
export const generateFreightSettlementApi = (carrierId: number, billPeriod: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<FreightSettlement>('/logistics/freight/settlements', { carrierId, billPeriod }, config)
