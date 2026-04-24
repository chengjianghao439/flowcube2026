import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
export interface TransferItem { id:number; productId:number; productCode:string; productName:string; unit:string; quantity:number; remark?:string }
export interface TransferOrder { id:number; orderNo:string; fromWarehouseId:number; fromWarehouseName:string; toWarehouseId:number; toWarehouseName:string; status:1|2|3|4; statusName:string; remark?:string; operatorName:string; createdAt:string; items?:TransferItem[] }
export interface CreateTransferParams { fromWarehouseId:number; fromWarehouseName:string; toWarehouseId:number; toWarehouseName:string; remark?:string; items:Omit<TransferItem,'id'>[] }
export const getTransferListApi   = (p:object) => client.get<PaginatedData<TransferOrder>>('/transfer', {params:p})
export const getTransferDetailApi = (id:number) => client.get<TransferOrder>(`/transfer/${id}`)
export const createTransferApi    = (d:CreateTransferParams) => client.post<{id:number;orderNo:string}>('/transfer', d)
export const confirmTransferApi   = (id:number) => client.post<null>(`/transfer/${id}/confirm`)
export const executeTransferApi   = (id:number) => client.post<null>(`/transfer/${id}/execute`)
export const cancelTransferApi    = (id:number) => client.post<null>(`/transfer/${id}/cancel`)
