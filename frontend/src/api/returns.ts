import { payloadClient as client } from './client'
import type { AxiosRequestConfig } from 'axios'
import type { PaginatedData } from '@/types'
import { withRequestKeyHeaders } from '@/lib/requestKey'

export interface ReturnSourceLabels { kind: 'kit' | 'ordinary'; kitCode: string | null; kitName: string | null; groupId: number; lineKey: string; taskId: number; taskNo: string | null; confirmedAt: string | null; warehouseId: number; warehouseName: string | null; allowDecimalQty: boolean | null }
export interface ReturnItem { dispatchComponentId?: number | null; commercialComponentId?: number | null; source?: ReturnSourceLabels | null; id:number; sourceItemId?:number|null; productId:number; productCode:string; productName:string; articleNumber?:string|null; spec?:string|null; color?:string|null; unit:string; entryUnit?:string; quantity:number; entryQty?:number; conversionRate?:number; unitPrice:number; amount:number }
export interface ReturnLinkedTask { id:number; taskNo:string; status:number; statusName:string; rejectedQty?:number; rejectedContainers?:RejectedContainer[] }
export interface PurchaseReturn { id:number; returnNo:string; supplierId:number; supplierName:string; warehouseId:number; warehouseName:string; purchaseOrderId?:number|null; purchaseOrderNo?:string; status:1|2|3|4; statusName:string; totalAmount:number; remark?:string; operatorName:string; createdAt:string; items?:ReturnItem[]; task?:ReturnLinkedTask|null }
export interface ReverseTaskContainer { id:number; barcode:string; qty:number; productId:number; productName:string }
export interface SaleReturnReverseTask {
  id:number; taskNo:string; status:number; statusName:string
  shippedAt?:string|null; createdAt:string; containers:ReverseTaskContainer[]
}
export interface SaleReturn { commercialModel?: 'kit-v1'; id:number; returnNo:string; customerId:number; customerName:string; warehouseId:number; warehouseName:string; saleOrderId?:number|null; saleOrderNo?:string; status:1|2|3|4; statusName:string; totalAmount:number; remark?:string; operatorName:string; createdAt:string; items?:ReturnItem[]; task?:ReturnLinkedTask|null; reverseTask?:SaleReturnReverseTask|null }
export interface ReturnSourceOrderItem { dispatchComponentId?: number; commercialComponentId?: number; sourceQuantity?: number; sourceBudgetAmount?: number; sourceFinancialEstimate?: number; actualQualifiedQty?: number; actualRefundGross?: number; actualRefundAmount?: number; kind?: ReturnSourceLabels['kind']; kitCode?: string | null; kitName?: string | null; groupId?: number; lineKey?: string; taskId?: number; taskNo?: string | null; confirmedAt?: string | null; warehouseId?: number; warehouseName?: string | null; allowDecimalQty?: boolean | null; sourceItemId:number; productId:number; productCode:string; productName:string; articleNumber?:string|null; spec?:string|null; color?:string|null; unit:string; quantity:number; returnedQty:number; remainingQty:number; unitPrice:number; amount:number }
export interface PurchaseReturnSourceOrder { id:number; orderNo:string; supplierId:number; supplierName:string; warehouseId:number; warehouseName:string; items:ReturnSourceOrderItem[] }
export interface SaleReturnSourceOrder { commercialModel?: 'kit-v1'; commercialRevision?: number; id:number; orderNo:string; customerId:number; customerName:string; warehouseId:number; warehouseName:string; items:ReturnSourceOrderItem[] }

// ─── 退货 PDA 任务 ──────────────────────────────────────────────────
export interface ReturnTaskItem {
  id: number; productId: number; productCode: string; productName: string; unit: string
  expectedQty: number; receivedQty: number; checkedQty: number; rejectedQty: number; putawayQty: number
}
export interface RejectedContainer { id: number; barcode: string; qty: number; productId: number; productName: string }
export interface ReturnTask {
  id: number; taskNo: string; returnType: string; returnId: number; returnNo: string
  warehouseId: number; warehouseName: string; partyName: string
  status: number; statusName: string; submittedAt: string | null; createdAt: string
  items?: ReturnTaskItem[]
  rejectedContainers?: RejectedContainer[]
  pendingPutawayContainers?: RejectedContainer[]
}

export const getPurchaseReturnsApi  = (p:object) => client.get<PaginatedData<PurchaseReturn>>('/returns/purchase', {params:p})
export const getPurchaseReturnDetailApi = (id:number) => client.get<PurchaseReturn>(`/returns/purchase/${id}`)
export const getPurchaseReturnSourceOrderApi = (orderNo:string) => client.get<PurchaseReturnSourceOrder>('/returns/purchase/source-order', { params:{ orderNo } })
export const createPurchaseReturnApi= (d:object, requestKey?: string) =>
  client.post<{id:number; returnNo:string}>('/returns/purchase', d, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
export const confirmPurchaseReturnApi=(id:number) => client.post<null>(`/returns/purchase/${id}/confirm`)
export const cancelPurchaseReturnApi = (id:number) => client.post<null>(`/returns/purchase/${id}/cancel`)
export const getSaleReturnsApi       = (p:object) => client.get<PaginatedData<SaleReturn>>('/returns/sale', {params:p})
export const getSaleReturnDetailApi  = (id:number, config?: AxiosRequestConfig) => client.get<SaleReturn>(`/returns/sale/${id}`, config)
export const getSaleReturnSourceOrderApi = (orderNo:string, config?: AxiosRequestConfig) => client.get<SaleReturnSourceOrder>('/returns/sale/source-order', { ...config, params:{ ...config?.params, orderNo } })
export const createSaleReturnApi     = (d:object, requestKey?: string, config?: AxiosRequestConfig) =>
  client.post<{id:number; returnNo:string}>('/returns/sale', d, { ...config, ...(requestKey ? { headers: withRequestKeyHeaders(requestKey) } : {}) })
export const confirmSaleReturnApi    = (id:number, config?: AxiosRequestConfig) => client.post<null>(`/returns/sale/${id}/confirm`, undefined, config)
/** 已有合格品入库时不能直接取消：后端返回 202 并生成返货出库单，取消动作要等仓库出库完成。 */
export interface SaleReturnCancelResult { pendingReverse: true; taskId: number; taskNo: string; alreadyRequested: boolean }
export const cancelSaleReturnApi     = (id:number, config?: AxiosRequestConfig) => client.post<SaleReturnCancelResult | null>(`/returns/sale/${id}/cancel`, undefined, config)

// ─── PDA 退货任务 API ──────────────────────────────────────────────
export const getPdaReturnTasksApi = () =>
  client.get<ReturnTask[]>('/return-tasks/pda')

export const getReturnTaskByIdApi = (id: number) =>
  client.get<ReturnTask>(`/return-tasks/${id}`)

export interface ReturnTaskActionResult {
  taskId: number
  status: number
  containers: Array<{ containerId: number; barcode: string; qty: number; status: number }>
  printJobIds: number[]
  noPrinterCount: number
}

export const receiveReturnApi = (id: number, data: { productId: number; packages: { qty: number }[] }, requestKey?: string) =>
  client.post<ReturnTaskActionResult>(`/return-tasks/${id}/receive`, data,
    requestKey ? { headers: withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }), skipGlobalError: true } : { headers: { 'X-Client': 'pda' }, skipGlobalError: true })

export const checkReturnApi = (id: number, data: { productId: number; passedQty: number; rejectedQty?: number }, requestKey?: string) =>
  client.post<ReturnTaskActionResult>(`/return-tasks/${id}/check`, data,
    requestKey ? { headers: withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }), skipGlobalError: true } : { headers: { 'X-Client': 'pda' }, skipGlobalError: true })

export interface ReturnPutawayContainer {
  containerId: number; barcode: string; taskId: number; warehouseId: number; status: number
}
export interface ReturnPutawayLocation {
  id: number; code: string; warehouseId: number; status: number
}
export const getReturnPutawayContainerApi = (id: number, barcode: string) =>
  client.get<ReturnPutawayContainer>(`/return-tasks/${id}/putaway-container`, {
    params: { barcode }, headers: { 'X-Client': 'pda' }, skipGlobalError: true,
  })
export const getReturnPutawayLocationApi = (id: number, barcode: string) =>
  client.get<ReturnPutawayLocation>(`/return-tasks/${id}/putaway-location`, {
    params: { barcode }, headers: { 'X-Client': 'pda' }, skipGlobalError: true,
  })

export const putawayReturnApi = (id: number, data: { containerId: number; locationId: number }, requestKey?: string) =>
  client.post(`/return-tasks/${id}/putaway`, data,
    requestKey ? { headers: withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }), skipGlobalError: true } : { headers: { 'X-Client': 'pda' }, skipGlobalError: true })
