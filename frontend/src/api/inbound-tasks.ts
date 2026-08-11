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
  QaDisposition,
  QaDisposeParams,
  QaDisposeResult,
  QaDispositionScanDetail,
  QaDisposeScanResult,
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

/** 来料质检（文档07）：仅 PDA。passedQty=合格量(含让步)，concessionQty=其中让步量(子集)，rejectedQty=拒收量。带 X-Client: pda */
export const qaCheckInboundApi = (id: number, data: { productId: number; passedQty: number; rejectedQty: number; concessionQty?: number; reason?: string }, requestKey?: string) =>
  client.post<{ taskId: number; passed: number; rejected: number; concession: number; qaStatus: number }>(`/inbound-tasks/${id}/check`, data, {
    headers: requestKey ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }) : { 'X-Client': 'pda' },
  })

export const cancelInboundApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post(`/inbound-tasks/${id}/cancel`, {}, config)

export const voidInboundReceiptApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post<InboundTask>(`/inbound-tasks/${id}/void-receipt`, {}, config)

/** 短装结案：提前结束收货（收货中→待上架），剩余未收量作罢 */
export const closeReceivingInboundApi = (id: number, config?: Parameters<typeof client.post>[2]) =>
  client.post(`/inbound-tasks/${id}/close-receiving`, {}, config)

/** 质检拒收处置历史（文档07 Phase2）：某收货订单的退供应商/报废单 */
export const getInboundQaDispositionsApi = (id: number) =>
  client.get<QaDisposition[]>(`/inbound-tasks/${id}/qa-dispositions`)

/** 处置质检拒收品（退供应商/报废）：ERP 决策创建处置单(待扫出)，只消费 REJECTED 容器、零 GL，带幂等键 */
export const qaDisposeInboundApi = (id: number, data: QaDisposeParams, requestKey?: string, config?: Parameters<typeof client.post>[2]) =>
  client.post<QaDisposeResult>(`/inbound-tasks/${id}/qa-dispose`, data, {
    ...(requestKey ? { headers: withRequestKeyHeaders(requestKey) } : {}),
    ...config,
  })

// ── 拒收处置 PDA 物理扫出（文档07 Phase3）──
/** PDA 待扫出处置单列表（status=1） */
export const getQaDisposePendingApi = () =>
  client.get<QaDisposition[]>('/inbound-tasks/qa-dispositions/pending')

/** 单个处置单的待扫/已扫容器清单 */
export const getQaDisposeScanDetailApi = (dispositionId: number) =>
  client.get<QaDispositionScanDetail>(`/inbound-tasks/qa-dispositions/${dispositionId}/scan-detail`)

/** PDA 扫一个 REJECTED 容器码物理确认出场（PDA-only，带 X-Client:pda + 幂等键） */
export const qaDisposeScanOutApi = (dispositionId: number, barcode: string, requestKey?: string) =>
  client.post<QaDisposeScanResult>(`/inbound-tasks/qa-dispositions/${dispositionId}/scan-out`, { barcode }, {
    headers: requestKey ? withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }) : { 'X-Client': 'pda' },
  })
