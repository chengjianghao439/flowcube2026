import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { RefundOrder, CreateRefundParams } from '@/types/refund'

export const getRefundListApi = (params: object) =>
  client.get<PaginatedData<RefundOrder>>('/refunds', { params })

export const getRefundDetailApi = (id: number) =>
  client.get<RefundOrder>(`/refunds/${id}`)

export const createRefundApi = (data: CreateRefundParams) =>
  client.post<{ id: number; refundNo: string }>('/refunds', data)

export const submitRefundApi = (id: number) =>
  client.post<null>(`/refunds/${id}/submit`)

export const executeRefundApi = (id: number) =>
  client.post<{ id: number; refundNo: string; amount: number }>(`/refunds/${id}/execute`)

export const cancelRefundApi = (id: number) =>
  client.post<null>(`/refunds/${id}/cancel`)
