import apiClient, { getApiClientBaseRevision, payloadClient as client } from './client'
import { getOperationRequestStatusApi } from './operation-requests'
import { useAuthStore } from '@/store/authStore'
import type { PaginatedData } from '@/types'
import type { StockCheck, CreateCheckParams, AbcClassRow, CycleCandidate, CycleRulesResult, CoverageRow, PendingScanCheck, ScanCheckDetail } from '@/types/stockcheck'
import { withRequestKeyHeaders } from '@/lib/requestKey'
export const getCheckListApi   = (params: object) => client.get<PaginatedData<StockCheck>>('/stockcheck', { params })
export const getCheckDetailApi = (id: number) => client.get<StockCheck>(`/stockcheck/${id}`)
export const createCheckApi    = (data: CreateCheckParams) => client.post<{ id: number }>('/stockcheck', data)
// ERP 盘点详情自行展示失败原因并保留草稿，避免全局与页面重复提示。
export const updateCheckItemsApi = (id: number, items: { id: number; actualQty: number }[]) => client.put<null>(`/stockcheck/${id}/items`, { items }, { skipGlobalError: true })
// 每份盘点仅能正式提交一次，键由账号和盘点单唯一确定，可跨重开恢复。
export async function submitCheckApi(id: number) {
  const { user, sessionGeneration } = useAuthStore.getState()
  if (!user?.id) throw new Error('登录状态已变化，请重新打开盘点单')
  const requestKey = `stockcheck-submit-${user.id}-${id}`
  const baseURL = apiClient.defaults.baseURL
  const revision = getApiClientBaseRevision()
  const config = { baseURL, automaticReplay: false as const, _erpApiFallbackTried: true, skipGlobalError: true }
  try {
    return await client.post<null>(`/stockcheck/${id}/submit`, undefined, {
      ...config, headers: withRequestKeyHeaders(requestKey),
    })
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (status && status < 500 && status !== 408) throw error
    if (revision !== getApiClientBaseRevision() || sessionGeneration !== useAuthStore.getState().sessionGeneration) throw error
    const receipt = await getOperationRequestStatusApi(requestKey, `stockcheck.submit.${id}`, config).catch(() => null)
    if (revision !== getApiClientBaseRevision() || sessionGeneration !== useAuthStore.getState().sessionGeneration) throw error
    if (receipt?.status === 'success' && receipt.resourceType === 'stockcheck' && Number(receipt.resourceId) === id) return null
    throw new Error('盘点提交结果待核对，请刷新详情；仍为盘点中时可用原请求重试')
  }
}
export const refreshCheckItemApi = (id: number, itemId: number) => client.post<{ itemId: number; productName: string; bookQty: number }>(`/stockcheck/${id}/items/${itemId}/refresh`, undefined, { skipGlobalError: true })
export const cancelCheckApi    = (id: number) => client.post<null>(`/stockcheck/${id}/cancel`, undefined, { skipGlobalError: true })

// PDA 扫码盘点（文档13 §4.3）：一律扫容器码——个体扫到即计 1，数量容器扫码后填实盘数
/** PDA 任务池：进行中的盘点单 */
export const getPendingScanChecksApi = () => client.get<PendingScanCheck[]>('/stockcheck/scan/pending')
/** PDA 作业页：该盘点单的明细行（含账面/已扫容器数与已扫明细） */
export const getScanCheckItemsApi = (id: number) => client.get<ScanCheckDetail>(`/stockcheck/${id}/scan-items`)
/** 提交某行现场扫到的全部容器（整行替换语义，天然幂等；实盘数由各行实盘之和派生） */
export const saveCheckItemScansApi = (id: number, itemId: number, scans: { barcode: string; countedQty?: number }[], requestKey?: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<{ itemId: number; scannedContainers: number; actualQty: number; bookQty: number; diffQty: number }>(
    `/stockcheck/${id}/items/${itemId}/scan`,
    { scans },
    { ...config, skipGlobalError: true, headers: { ...config?.headers, 'X-Client': 'pda', ...(requestKey ? withRequestKeyHeaders(requestKey) : {}) } },
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
