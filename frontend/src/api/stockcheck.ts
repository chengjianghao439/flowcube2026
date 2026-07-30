import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { StockCheck, CreateCheckParams, AbcClassRow, CycleCandidate } from '@/types/stockcheck'
export const getCheckListApi   = (params: object) => client.get<PaginatedData<StockCheck>>('/stockcheck', { params })
export const getCheckDetailApi = (id: number) => client.get<StockCheck>(`/stockcheck/${id}`)
export const createCheckApi    = (data: CreateCheckParams) => client.post<{ id: number }>('/stockcheck', data)
export const updateCheckItemsApi = (id: number, items: { id: number; actualQty: number }[]) => client.put<null>(`/stockcheck/${id}/items`, { items })
export const submitCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/submit`)
export const refreshCheckItemApi = (id: number, itemId: number) => client.post<{ itemId: number; productName: string; bookQty: number }>(`/stockcheck/${id}/items/${itemId}/refresh`)
export const cancelCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/cancel`)

// 循环盘点 ABC / 候选（文档 08）
export const recomputeAbcApi = (data: { warehouseId: number; metricType?: string; windowDays?: number }) =>
  client.post<{ warehouseId: number; metricType: string; windowDays: number; classified: number; totalMetric: number }>('/stockcheck/abc/recompute', data)
export const getAbcListApi = (params: { warehouseId?: number; abcClass?: string }) =>
  client.get<AbcClassRow[]>('/stockcheck/abc', { params })
export const getCycleCandidatesApi = (params: { warehouseId: number; scopeType?: string; scopeValue?: string }) =>
  client.get<CycleCandidate>('/stockcheck/cycle/candidates', { params })
