import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
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

// 后端 execute 走 beginResourceOperationRequest：带稳定 X-Request-Key 才能幂等，
// 否则网络重试会重复写 payment_records（2026-09-26 一致性审查 · 任务 4）。
/**
 * 执行退款。带 requestKey 幂等：连点/断网重试不会重复退钱。
 *
 * backfill 有值＝这次不是「执行」，而是把它**提交成一张跨期补录申请**：退款日期落在
 * 已结账期间时后端 409，业务入口据此改走审批流，用**同一个 requestKey** 重发并带上原因。
 * 此时返回体是申请单 `{ id, applicationNo }`（HTTP 202），不是退款结果——调用方按
 * `applicationNo` 是否存在区分，不能因为 HTTP 状态拿不到就当成退款成功。
 */
export const executeRefundApi = (
  id: number,
  requestKey?: string,
  backfill?: { reason: string },
  config?: { skipGlobalError?: boolean },
) =>
  client.post<{ id: number; refundNo: string; amount: number; applicationNo?: string }>(
    `/refunds/${id}/execute`,
    backfill ? { backfillRequest: true, backfillReason: backfill.reason } : undefined,
    requestKey ? { ...config, headers: withRequestKeyHeaders(requestKey) } : config,
  )

export const cancelRefundApi = (id: number) =>
  client.post<null>(`/refunds/${id}/cancel`)
