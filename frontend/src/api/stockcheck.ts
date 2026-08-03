import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { StockCheck, CreateCheckParams, AbcClassRow, CycleCandidate, CycleRulesResult, PendingSerialCheck, SerialCheckDetail } from '@/types/stockcheck'
import { withRequestKeyHeaders } from '@/lib/requestKey'
export const getCheckListApi   = (params: object) => client.get<PaginatedData<StockCheck>>('/stockcheck', { params })
export const getCheckDetailApi = (id: number) => client.get<StockCheck>(`/stockcheck/${id}`)
export const createCheckApi    = (data: CreateCheckParams) => client.post<{ id: number }>('/stockcheck', data)
export const updateCheckItemsApi = (id: number, items: { id: number; actualQty: number }[]) => client.put<null>(`/stockcheck/${id}/items`, { items })
export const submitCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/submit`)
export const refreshCheckItemApi = (id: number, itemId: number) => client.post<{ itemId: number; productName: string; bookQty: number }>(`/stockcheck/${id}/items/${itemId}/refresh`)
export const cancelCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/cancel`)

// 序列号级盘点（文档04 Phase3b·C-full）：PDA 逐台扫在架序列号
/** PDA 任务池：进行中、含序列号商品的盘点单 */
export const getPendingSerialChecksApi = () => client.get<PendingSerialCheck[]>('/stockcheck/serial/pending')
/** PDA 作业页：该盘点单的序列号商品行（含已扫台数/账面台数） */
export const getSerialCheckItemsApi = (id: number) => client.get<SerialCheckDetail>(`/stockcheck/${id}/serial-items`)
/** 提交某行现场扫到的全部在架序列号（整行替换语义，天然幂等；实盘数由台数派生） */
export const saveCheckItemSerialsApi = (id: number, itemId: number, serialNos: string[], requestKey?: string) =>
  client.post<{ itemId: number; scannedCount: number; bookQty: number; diffQty: number }>(
    `/stockcheck/${id}/items/${itemId}/serials`,
    { serialNos },
    { headers: requestKey ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }) : { 'X-Client': 'pda' } },
  )

// 循环盘点 ABC / 候选（文档 08）
export const recomputeAbcApi = (data: { warehouseId: number; metricType?: string; windowDays?: number }) =>
  client.post<{ warehouseId: number; metricType: string; windowDays: number; classified: number; totalMetric: number }>('/stockcheck/abc/recompute', data)
export const getAbcListApi = (params: { warehouseId?: number; abcClass?: string }) =>
  client.get<AbcClassRow[]>('/stockcheck/abc', { params })
export const getCycleCandidatesApi = (params: { warehouseId: number; scopeType?: string; scopeValue?: string }) =>
  client.get<CycleCandidate>('/stockcheck/cycle/candidates', { params })
export const getCycleRulesApi = (warehouseId?: number) =>
  client.get<CycleRulesResult>('/stockcheck/cycle/rules', { params: warehouseId ? { warehouseId } : {} })
export const saveCycleRulesApi = (data: { warehouseId?: number; rules: { abcClass: string; intervalDays: number; batchLimit: number; enabled?: boolean }[] }) =>
  client.put<CycleRulesResult>('/stockcheck/cycle/rules', data)
