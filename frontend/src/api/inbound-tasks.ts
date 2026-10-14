import { payloadClient as client } from './client'
import { recordIdentityByFields } from './allRecords'
import type { PaginatedData, QueryParams } from '@/types'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type {
  InboundTask,
  ReceiveParams,
  ReceivePackageResult,
  PutawayParams,
  InboundContainersResult,
  CreateInboundTaskResult,
  CreateInboundTaskParams,
  InboundPurchaseCandidate,
  InboundTaskEditContext,
  UpdateInboundTaskParams,
  UpdateInboundTaskResult,
} from '@/types/inbound-tasks'

export const getInboundTasksApi = (params: QueryParams & { status?: number | number[]; productId?: number; supplierId?: number }, config?: Parameters<typeof client.get>[1]) =>
  client.get<PaginatedData<InboundTask>>('/inbound-tasks', { ...config, params })

export const getInboundPurchaseCandidatesApi = (params: { supplierId: number; keyword?: string }, config?: Parameters<typeof client.get>[1]) =>
  client.get<PaginatedData<InboundPurchaseCandidate>>('/inbound-tasks/purchase-items', { ...config, params: { ...params, bounded: 1, page: 1, pageSize: 200 } }, recordIdentityByFields('purchaseItemId'))

/** 确认前按完整选中身份分批核实；草稿数量不因余量变化被自动覆盖。 */
export async function verifyInboundPurchaseSelection(supplierId: number, ids: number[]): Promise<InboundPurchaseCandidate[]> {
  const rows: InboundPurchaseCandidate[] = []
  for (let start = 0; start < ids.length; start += 200) {
    const batch = await client.get<InboundPurchaseCandidate[]>('/inbound-tasks/purchase-items', { params: { supplierId, purchaseItemIds: ids.slice(start, start + 200).join(',') }, skipGlobalError: true })
    rows.push(...batch)
  }
  return rows
}

export const createInboundTaskApi = (data: CreateInboundTaskParams, config?: Parameters<typeof client.post>[2], requestKey?: string) =>
  client.post<CreateInboundTaskResult>('/inbound-tasks', data, { ...config, headers: requestKey ? { ...config?.headers, ...withRequestKeyHeaders(requestKey) } : config?.headers })

export const getInboundTaskByIdApi = (id: number, config?: Parameters<typeof client.get>[1]) =>
  client.get<InboundTask>(`/inbound-tasks/${id}`, config)

export const submitInboundTaskApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post<InboundTask>(`/inbound-tasks/${id}/submit`, {}, config)

export const getInboundTaskContainersApi = (id: number, config?: Parameters<typeof client.get>[1]) =>
  client.get<InboundContainersResult>(`/inbound-tasks/${id}/containers`, config)

/** 仅 PDA 可调：后端 pdaOnly 校验请求头 X-Client: pda（漏带头会 403 PDA_ONLY） */
export const receiveInboundApi = (id: number, data: ReceiveParams, requestKey?: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<ReceivePackageResult>(`/inbound-tasks/${id}/receive`, data, {
    ...config, skipGlobalError: true,
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { ...config?.headers, 'X-Client': 'pda' } as Record<string, string>)
      : { ...config?.headers, 'X-Client': 'pda' },
  })

/** 仅 PDA 可调：后端校验请求头 X-Client: pda */
export const putawayInboundApi = (id: number, data: PutawayParams, requestKey?: string) =>
  client.post(`/inbound-tasks/${id}/putaway`, data, {
    skipGlobalError: true,
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
      : { 'X-Client': 'pda' },
  })

export const cancelInboundApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post(`/inbound-tasks/${id}/cancel`, {}, config)

export const voidInboundReceiptApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post<InboundTask>(`/inbound-tasks/${id}/void-receipt`, {}, config)

export interface CloseReceivingResult { taskId: number; status: 3 | 4 }
/** 短装结束：实收全上架时同事务完结，否则等待余下实收上架。 */
export const closeReceivingInboundApi = (id: number, config?: Parameters<typeof client.post>[2], requestKey?: string) =>
  client.post<CloseReceivingResult>(`/inbound-tasks/${id}/close-receiving`, {}, {
    ...config,
    headers: requestKey ? { ...config?.headers, ...withRequestKeyHeaders(requestKey) } : config?.headers,
  })

export const getInboundTaskEditContextApi = (id: number, config?: Parameters<typeof client.get>[1]) =>
  client.get<InboundTaskEditContext>(`/inbound-tasks/${id}/edit-context`, config)

export const getInboundEditPurchaseCandidatesApi = (id: number, keyword: string, config?: Parameters<typeof client.get>[1]) =>
  client.get<PaginatedData<InboundPurchaseCandidate>>(`/inbound-tasks/${id}/edit-purchase-items`, { ...config, params: { keyword, bounded: 1, page: 1, pageSize: 200 } }, recordIdentityByFields('purchaseItemId'))

export async function verifyInboundEditPurchaseSelection(id: number, ids: number[], config?: Parameters<typeof client.get>[1]): Promise<InboundPurchaseCandidate[]> {
  const rows: InboundPurchaseCandidate[] = []
  for (let start = 0; start < ids.length; start += 200) {
    rows.push(...await client.get<InboundPurchaseCandidate[]>(`/inbound-tasks/${id}/edit-purchase-items`, { ...config, params: { purchaseItemIds: ids.slice(start, start + 200).join(',') }, skipGlobalError: true }))
  }
  return rows
}

export const updateInboundTaskApi = (id: number, data: UpdateInboundTaskParams, requestKey: string, config?: Parameters<typeof client.put>[2]) =>
  client.put<UpdateInboundTaskResult>(`/inbound-tasks/${id}`, data, { ...config, headers: { ...config?.headers, ...withRequestKeyHeaders(requestKey) } })

export interface InboundReprintResult { taskId: number; mode: string; count: number; jobIds: number[]; failedJobIds: number[]; noPrinterCount: number; requestId: number }
export const reprintInboundTaskApi = (id: number, payload: { mode: 'task' | 'item' | 'barcode'; itemId?: number; barcode?: string }, requestKey: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<InboundReprintResult>(`/inbound-tasks/${id}/reprint`, payload, { ...config, headers: withRequestKeyHeaders(requestKey, config?.headers as Record<string, string>) })
