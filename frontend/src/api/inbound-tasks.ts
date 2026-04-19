import client from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
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
  AuditInboundTaskParams,
  ReprintInboundTaskParams,
  ReprintInboundTaskResult,
} from '@/types/inbound-tasks'

export const getInboundTasksApi = (params: QueryParams & { status?: number; productId?: number }) =>
  client.get<ApiResponse<PaginatedData<InboundTask>>>('/inbound-tasks', { params })

export const getInboundPurchaseCandidatesApi = (params: { supplierId: number; keyword?: string }) =>
  client.get<ApiResponse<InboundPurchaseCandidate[]>>('/inbound-tasks/purchase-items', { params })

export const createInboundTaskApi = (data: CreateInboundTaskParams) =>
  client.post<ApiResponse<CreateInboundTaskResult>>('/inbound-tasks', data)

export const getInboundTaskByIdApi = (id: number) =>
  client.get<ApiResponse<InboundTask>>(`/inbound-tasks/${id}`)

export const submitInboundTaskApi = (id: number) =>
  client.post<ApiResponse<InboundTask>>(`/inbound-tasks/${id}/submit`)

export const auditInboundTaskApi = (id: number, data: AuditInboundTaskParams) =>
  client.post<ApiResponse<InboundTask>>(`/inbound-tasks/${id}/audit`, data)

export const reprintInboundTaskApi = (id: number, data: ReprintInboundTaskParams) =>
  client.post<ApiResponse<ReprintInboundTaskResult>>(`/inbound-tasks/${id}/reprint`, data)

export const getInboundTaskContainersApi = (id: number) =>
  client.get<ApiResponse<InboundContainersResult>>(`/inbound-tasks/${id}/containers`)

export const receiveInboundApi = (id: number, data: ReceiveParams, requestKey?: string) =>
  client.post<ApiResponse<ReceivePackageResult>>(`/inbound-tasks/${id}/receive`, data, requestKey
    ? { headers: withRequestKeyHeaders(requestKey) }
    : undefined)

/** 仅 PDA 可调：后端校验请求头 X-Client: pda */
export const putawayInboundApi = (id: number, data: PutawayParams, requestKey?: string) =>
  client.post(`/inbound-tasks/${id}/putaway`, data, {
    headers: requestKey
      ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })
      : { 'X-Client': 'pda' },
  })

/** 管理员补录上架（ERP 禁用时），需 roleId=1 */
export const adminPutawayInboundApi = (data: PutawayParams & { taskId: number }) =>
  client.post('/admin/putaway', data)

export const cancelInboundApi = (id: number) =>
  client.post(`/inbound-tasks/${id}/cancel`)
