import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { StockCheck, CreateCheckParams, AbcClassRow, CycleCandidate, CycleRulesResult, CoverageRow, PendingScanCheck, ScanCheckDetail } from '@/types/stockcheck'
import { withRequestKeyHeaders } from '@/lib/requestKey'
export const getCheckListApi   = (params: object) => client.get<PaginatedData<StockCheck>>('/stockcheck', { params })
export const getCheckDetailApi = (id: number) => client.get<StockCheck>(`/stockcheck/${id}`)
export const createCheckApi    = (data: CreateCheckParams) => client.post<{ id: number }>('/stockcheck', data)
export const updateCheckItemsApi = (id: number, items: { id: number; actualQty: number }[]) => client.put<null>(`/stockcheck/${id}/items`, { items })
export const submitCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/submit`)
export const refreshCheckItemApi = (id: number, itemId: number) => client.post<{ itemId: number; productName: string; bookQty: number }>(`/stockcheck/${id}/items/${itemId}/refresh`)
export const cancelCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/cancel`)

// PDA 扫码盘点（文档13 §4.3）：一律扫容器码——个体扫到即计 1，数量容器扫码后填实盘数
/** PDA 任务池：进行中的盘点单 */
export const getPendingScanChecksApi = () => client.get<PendingScanCheck[]>('/stockcheck/scan/pending')
/** PDA 作业页：该盘点单的明细行（含账面/已扫容器数与已扫明细） */
export const getScanCheckItemsApi = (id: number) => client.get<ScanCheckDetail>(`/stockcheck/${id}/scan-items`)
/** 提交某行现场扫到的全部容器（整行替换语义，天然幂等；实盘数由各行实盘之和派生） */
export const saveCheckItemScansApi = (id: number, itemId: number, scans: { barcode: string; countedQty?: number }[], requestKey?: string) =>
  client.post<{ itemId: number; scannedContainers: number; actualQty: number; bookQty: number; diffQty: number }>(
    `/stockcheck/${id}/items/${itemId}/scan`,
    { scans },
    { headers: requestKey ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }) : { 'X-Client': 'pda' } },
  )

// 分批盘点 ABC / 候选（文档 08）
export const recomputeAbcApi = (data: { warehouseId: number; metricType?: string; windowDays?: number }, config?: Parameters<typeof client.post>[2]) =>
  client.post<{ warehouseId: number; metricType: string; windowDays: number; classified: number; totalMetric: number }>('/stockcheck/abc/recompute', data, config)
export const getAbcListApi = (params: { warehouseId?: number; abcClass?: string }) =>
  client.get<AbcClassRow[]>('/stockcheck/abc', { params })
export const getCycleCandidatesApi = (params: { warehouseId: number; scopeType?: string; scopeValue?: string }) =>
  client.get<CycleCandidate>('/stockcheck/cycle/candidates', { params })
export const getCycleRulesApi = (warehouseId?: number) =>
  client.get<CycleRulesResult>('/stockcheck/cycle/rules', { params: warehouseId ? { warehouseId } : {} })
export const getCoverageApi = (params: { warehouseId?: number }) =>
  client.get<CoverageRow[]>('/stockcheck/cycle/coverage', { params })
export const saveCycleRulesApi = (data: { warehouseId?: number; rules: { abcClass: string; intervalDays: number; batchLimit: number; enabled?: boolean }[] }, config?: Parameters<typeof client.put>[2]) =>
  client.put<CycleRulesResult>('/stockcheck/cycle/rules', data, config)
