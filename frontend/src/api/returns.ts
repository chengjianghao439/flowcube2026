import client from './client'
import type { ApiResponse, PaginatedData } from '@/types'
export interface ReturnItem { id:number; productId:number; productCode:string; productName:string; unit:string; quantity:number; unitPrice:number; amount:number }
export interface PurchaseReturn { id:number; returnNo:string; supplierId:number; supplierName:string; warehouseId:number; warehouseName:string; purchaseOrderNo?:string; status:1|2|3|4; statusName:string; totalAmount:number; remark?:string; operatorName:string; createdAt:string; items?:ReturnItem[] }
export interface SaleReturn { id:number; returnNo:string; customerId:number; customerName:string; warehouseId:number; warehouseName:string; saleOrderNo?:string; status:1|2|3|4; statusName:string; totalAmount:number; remark?:string; operatorName:string; createdAt:string; items?:ReturnItem[] }
export const getPurchaseReturnsApi  = (p:object) => client.get<ApiResponse<PaginatedData<PurchaseReturn>>>('/returns/purchase', {params:p})
export const createPurchaseReturnApi= (d:object) => client.post<ApiResponse<{id:number}>>('/returns/purchase', d)
export const confirmPurchaseReturnApi=(id:number) => client.post<ApiResponse<null>>(`/returns/purchase/${id}/confirm`)
export const executePurchaseReturnApi=(id:number) => client.post<ApiResponse<null>>(`/returns/purchase/${id}/execute`)
export const cancelPurchaseReturnApi = (id:number) => client.post<ApiResponse<null>>(`/returns/purchase/${id}/cancel`)
export const getSaleReturnsApi       = (p:object) => client.get<ApiResponse<PaginatedData<SaleReturn>>>('/returns/sale', {params:p})
export const createSaleReturnApi     = (d:object) => client.post<ApiResponse<{id:number}>>('/returns/sale', d)
export const confirmSaleReturnApi    = (id:number) => client.post<ApiResponse<null>>(`/returns/sale/${id}/confirm`)
export const executeSaleReturnApi    = (id:number) => client.post<ApiResponse<null>>(`/returns/sale/${id}/execute`)
export const cancelSaleReturnApi     = (id:number) => client.post<ApiResponse<null>>(`/returns/sale/${id}/cancel`)
