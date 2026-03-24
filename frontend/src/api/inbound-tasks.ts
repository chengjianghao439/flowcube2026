import client from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { InboundTask, ReceiveParams, PutawayParams } from '@/types/inbound-tasks'

export const getInboundTasksApi = (params: QueryParams & { status?: number }) =>
  client.get<ApiResponse<PaginatedData<InboundTask>>>('/inbound-tasks', { params })

export const getInboundTaskByIdApi = (id: number) =>
  client.get<ApiResponse<InboundTask>>(`/inbound-tasks/${id}`)

export const receiveInboundApi = (id: number, data: ReceiveParams) =>
  client.post(`/inbound-tasks/${id}/receive`, data)

export const putawayInboundApi = (id: number, data: PutawayParams) =>
  client.post(`/inbound-tasks/${id}/putaway`, data)

export const cancelInboundApi = (id: number) =>
  client.post(`/inbound-tasks/${id}/cancel`)
