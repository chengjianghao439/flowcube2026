import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
export interface ReturnItem { id:number; sourceItemId?:number|null; productId:number; productCode:string; productName:string; unit:string; quantity:number; unitPrice:number; amount:number }
export interface PurchaseReturn { id:number; returnNo:string; supplierId:number; supplierName:string; warehouseId:number; warehouseName:string; purchaseOrderId?:number|null; purchaseOrderNo?:string; status:1|2|3|4; statusName:string; totalAmount:number; remark?:string; operatorName:string; createdAt:string; items?:ReturnItem[] }
export interface SaleReturn { id:number; returnNo:string; customerId:number; customerName:string; warehouseId:number; warehouseName:string; saleOrderId?:number|null; saleOrderNo?:string; status:1|2|3|4; statusName:string; totalAmount:number; remark?:string; operatorName:string; createdAt:string; items?:ReturnItem[] }
export interface ReturnSourceOrderItem { sourceItemId:number; productId:number; productCode:string; productName:string; unit:string; quantity:number; returnedQty:number; remainingQty:number; unitPrice:number; amount:number }
export interface PurchaseReturnSourceOrder { id:number; orderNo:string; supplierId:number; supplierName:string; warehouseId:number; warehouseName:string; items:ReturnSourceOrderItem[] }
export interface SaleReturnSourceOrder { id:number; orderNo:string; customerId:number; customerName:string; warehouseId:number; warehouseName:string; items:ReturnSourceOrderItem[] }
export const getPurchaseReturnsApi  = (p:object) => client.get<PaginatedData<PurchaseReturn>>('/returns/purchase', {params:p})
export const getPurchaseReturnSourceOrderApi = (orderNo:string) => client.get<PurchaseReturnSourceOrder>('/returns/purchase/source-order', { params:{ orderNo } })
export const createPurchaseReturnApi= (d:object) => client.post<{id:number}>('/returns/purchase', d)
export const confirmPurchaseReturnApi=(id:number) => client.post<null>(`/returns/purchase/${id}/confirm`)
export const executePurchaseReturnApi=(id:number) => client.post<null>(`/returns/purchase/${id}/execute`)
export const cancelPurchaseReturnApi = (id:number) => client.post<null>(`/returns/purchase/${id}/cancel`)
export const getSaleReturnsApi       = (p:object) => client.get<PaginatedData<SaleReturn>>('/returns/sale', {params:p})
export const getSaleReturnSourceOrderApi = (orderNo:string) => client.get<SaleReturnSourceOrder>('/returns/sale/source-order', { params:{ orderNo } })
export const createSaleReturnApi     = (d:object) => client.post<{id:number}>('/returns/sale', d)
export const confirmSaleReturnApi    = (id:number) => client.post<null>(`/returns/sale/${id}/confirm`)
export const executeSaleReturnApi    = (id:number) => client.post<null>(`/returns/sale/${id}/execute`)
export const cancelSaleReturnApi     = (id:number) => client.post<null>(`/returns/sale/${id}/cancel`)
