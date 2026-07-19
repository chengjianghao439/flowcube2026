import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'
export interface TransferItem { id:number; productId:number; productCode:string; productName:string; unit:string; articleNumber?:string|null; spec?:string|null; color?:string|null; quantity:number; deductedQty?:number; receivedQty?:number; remark?:string }
export interface TransferOrder { id:number; orderNo:string; fromWarehouseId:number; fromWarehouseName:string; toWarehouseId:number; toWarehouseName:string; status:1|2|3|4|5; statusName:string; remark?:string; submittedAt?:string|null; submittedByName?:string|null; operatorName:string; createdAt:string; items?:TransferItem[] }
export interface CreateTransferParams { fromWarehouseId:number; fromWarehouseName:string; toWarehouseId:number; toWarehouseName:string; remark?:string; items:Omit<TransferItem,'id'>[] }
export const getTransferListApi   = (p:object) => client.get<PaginatedData<TransferOrder>>('/transfer', {params:p})
export const getTransferDetailApi = (id:number) => client.get<TransferOrder>(`/transfer/${id}`)
export const createTransferApi    = (d:CreateTransferParams) => client.post<{id:number;orderNo:string}>('/transfer', d)
export const updateTransferApi    = (id:number, d:CreateTransferParams) => client.put<TransferOrder>(`/transfer/${id}`, d)
export const confirmTransferApi   = (id:number) => client.post<null>(`/transfer/${id}/confirm`)
export const cancelTransferApi    = (id:number) => client.post<null>(`/transfer/${id}/cancel`)
/** 在途异常了结（运输丢失等无法正常入库时的应急收尾），需管理员权限 */
export const forceCloseTransferApi = (id:number, reason:string) => client.post<null>(`/transfer/${id}/force-close`, { reason })

// ── PDA 调拨执行（仅 PDA：后端校验 X-Client: pda + 设备会话）──
export interface TransferScanResult { transferId:number; containerBarcode:string; productId:number; productName?:string; qty:number; completed?:boolean }
export const scanOutTransferApi = (id:number, containerBarcode:string, requestKey?:string) =>
  client.post<TransferScanResult>(`/transfer/${id}/scan-out`, { containerBarcode }, {
    headers: requestKey ? withRequestKeyHeaders(requestKey, { 'X-Client':'pda' }) : { 'X-Client':'pda' },
  })
export const scanInTransferApi = (id:number, containerBarcode:string, locationId:number, requestKey?:string) =>
  client.post<TransferScanResult>(`/transfer/${id}/scan-in`, { containerBarcode, locationId }, {
    headers: requestKey ? withRequestKeyHeaders(requestKey, { 'X-Client':'pda' }) : { 'X-Client':'pda' },
  })
