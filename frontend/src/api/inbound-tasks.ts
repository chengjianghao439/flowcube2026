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
  ReprintInboundTaskParams,
  ReprintInboundTaskResult,
  QaDisposition,
  QaDisposeParams,
  QaDisposeResult,
} from '@/types/inbound-tasks'

export const getInboundTasksApi = (params: QueryParams & { status?: number | number[]; productId?: number; supplierId?: number }) =>
  client.get<PaginatedData<InboundTask>>('/inbound-tasks', { params })

export const getInboundPurchaseCandidatesApi = (params: { supplierId: number; keyword?: string }) =>
  client.get<InboundPurchaseCandidate[]>('/inbound-tasks/purchase-items', { params })

export const createInboundTaskApi = (data: CreateInboundTaskParams) =>
  client.post<CreateInboundTaskResult>('/inbound-tasks', data)

export const getInboundTaskByIdApi = (id: number) =>
  client.get<InboundTask>(`/inbound-tasks/${id}`)

export const submitInboundTaskApi = (id: number) =>
  client.post<InboundTask>(`/inbound-tasks/${id}/submit`)

export const reprintInboundTaskApi = (id: number, data: ReprintInboundTaskParams) =>
  client.post<ReprintInboundTaskResult>(`/inbound-tasks/${id}/reprint`, data)

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

/** 来料质检（文档07）：仅 PDA，合格量(含让步接收)/拒收量。带 X-Client: pda */
export const qaCheckInboundApi = (id: number, data: { productId: number; passedQty: number; rejectedQty: number; reason?: string }, requestKey?: string) =>
  client.post<{ taskId: number; passed: number; rejected: number; qaStatus: number }>(`/inbound-tasks/${id}/check`, data, {
    headers: requestKey ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }) : { 'X-Client': 'pda' },
  })

/** 管理员补录上架（ERP 禁用时），需 roleId=1 */
export const adminPutawayInboundApi = (data: PutawayParams & { taskId: number }) =>
  client.post('/admin/putaway', data)

export const cancelInboundApi = (id: number) =>
  client.post(`/inbound-tasks/${id}/cancel`)

export const voidInboundReceiptApi = (id: number) =>
  client.post<InboundTask>(`/inbound-tasks/${id}/void-receipt`)

/** 短装结案：提前结束收货（收货中→待上架），剩余未收量作罢 */
export const closeReceivingInboundApi = (id: number) =>
  client.post(`/inbound-tasks/${id}/close-receiving`)

// ── 供应商来料质检合格率报表（文档07 Phase3，只读）──
export interface QaSupplierReportRow {
  supplierName: string
  taskCount: number
  productCount: number
  checkedQty: number
  passedQty: number
  rejectedQty: number
  passRate: number    // 百分比，两位小数
  returnQty: number   // 拒收处置·退供应商量
  scrapQty: number    // 拒收处置·报废量
}
export interface QaSupplierReport {
  list: QaSupplierReportRow[]
  summary: { checkedQty: number; passedQty: number; rejectedQty: number; returnQty: number; scrapQty: number; supplierCount: number; passRate: number }
}
export const getQaSupplierReportApi = (params: { startDate?: string; endDate?: string }) =>
  client.get<QaSupplierReport>('/inbound-tasks/qa-supplier-report', { params })

/** 质检拒收处置历史（文档07 Phase2）：某收货订单的退供应商/报废单 */
export const getInboundQaDispositionsApi = (id: number) =>
  client.get<QaDisposition[]>(`/inbound-tasks/${id}/qa-dispositions`)

/** 一键处置质检拒收品（退供应商/报废）：只消费 REJECTED 容器、零 GL。ERP 侧后台动作，带幂等键 */
export const qaDisposeInboundApi = (id: number, data: QaDisposeParams, requestKey?: string) =>
  client.post<QaDisposeResult>(`/inbound-tasks/${id}/qa-dispose`, data, requestKey
    ? { headers: withRequestKeyHeaders(requestKey) }
    : undefined)
