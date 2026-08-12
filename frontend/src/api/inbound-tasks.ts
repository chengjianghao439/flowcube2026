import { payloadClient as client } from './client'
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
} from '@/types/inbound-tasks'

export const getInboundTasksApi = (params: QueryParams & { status?: number | number[]; productId?: number; supplierId?: number }) =>
  client.get<PaginatedData<InboundTask>>('/inbound-tasks', { params })

export const getInboundPurchaseCandidatesApi = (params: { supplierId: number; keyword?: string }) =>
  client.get<InboundPurchaseCandidate[]>('/inbound-tasks/purchase-items', { params })

export const createInboundTaskApi = (data: CreateInboundTaskParams, config?: Parameters<typeof client.post>[2]) =>
  client.post<CreateInboundTaskResult>('/inbound-tasks', data, config)

export const getInboundTaskByIdApi = (id: number) =>
  client.get<InboundTask>(`/inbound-tasks/${id}`)

export const submitInboundTaskApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post<InboundTask>(`/inbound-tasks/${id}/submit`, {}, config)

export const getInboundTaskContainersApi = (id: number) =>
  client.get<InboundContainersResult>(`/inbound-tasks/${id}/containers`)

export const receiveInboundApi = (id: number, data: ReceiveParams, requestKey?: string) =>
  client.post<ReceivePackageResult>(`/inbound-tasks/${id}/receive`, data, requestKey
    ? { headers: withRequestKeyHeaders(requestKey) }
    : undefined)

/** 仅 PDA 可调：后端校验请求头 X-Client: pda */
export const putawayInboundApi = (id: number, data: PutawayParams, requestKey?: string) =>
  client.post(`/inbound-tasks/${id}/putaway`, data, {
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
      : { 'X-Client': 'pda' },
  })

export const cancelInboundApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post(`/inbound-tasks/${id}/cancel`, {}, config)

export const voidInboundReceiptApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post<InboundTask>(`/inbound-tasks/${id}/void-receipt`, {}, config)

/** 短装结案：提前结束收货（收货中→待上架），剩余未收量作罢 */
export const closeReceivingInboundApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post(`/inbound-tasks/${id}/close-receiving`, {}, config)
