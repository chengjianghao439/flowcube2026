import client from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
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

export const getInboundTasksApi = (params: QueryParams & { status?: number }) =>
  client.get<ApiResponse<PaginatedData<InboundTask>>>('/inbound-tasks', { params })

export const getInboundPurchaseCandidatesApi = (params: { supplierId: number; keyword?: string }) =>
  client.get<ApiResponse<InboundPurchaseCandidate[]>>('/inbound-tasks/purchase-items', { params })

export const createInboundTaskApi = (data: CreateInboundTaskParams) =>
  client.post<ApiResponse<CreateInboundTaskResult>>('/inbound-tasks', data)

export const getInboundTaskByIdApi = (id: number) =>
  client.get<ApiResponse<InboundTask>>(`/inbound-tasks/${id}`)

export const getInboundTaskContainersApi = (id: number) =>
  client.get<ApiResponse<InboundContainersResult>>(`/inbound-tasks/${id}/containers`)

export const receiveInboundApi = (id: number, data: ReceiveParams) =>
  client.post<ApiResponse<ReceivePackageResult>>(`/inbound-tasks/${id}/receive`, data)

/** 仅 PDA 可调：后端校验请求头 X-Client: pda */
export const putawayInboundApi = (id: number, data: PutawayParams) =>
  client.post(`/inbound-tasks/${id}/putaway`, data, { headers: { 'X-Client': 'pda' } })

/** 管理员补录上架（ERP 禁用时），需 roleId=1 */
export const adminPutawayInboundApi = (data: PutawayParams & { taskId: number }) =>
  client.post('/admin/putaway', data)

export const cancelInboundApi = (id: number) =>
  client.post(`/inbound-tasks/${id}/cancel`)
