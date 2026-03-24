import client from './client'
import type { ApiResponse } from '@/types'

export interface PriceList { id:number; name:string; remark?:string; isActive:number; createdAt:string }
export interface PriceListItem { id:number; productId:number; productCode:string; productName:string; unit:string; salePrice:number }

export const getPriceListsApi   = () => client.get<ApiResponse<PriceList[]>>('/price-lists')
export const createPriceListApi = (d:{name:string;remark?:string}) => client.post<ApiResponse<{id:number}>>('/price-lists', d)
export const updatePriceListApi = (id:number, d:object) => client.put<ApiResponse<null>>(`/price-lists/${id}`, d)
export const deletePriceListApi = (id:number) => client.delete<ApiResponse<null>>(`/price-lists/${id}`)
export const getPriceListItemsApi    = (id:number) => client.get<ApiResponse<PriceListItem[]>>(`/price-lists/${id}/items`)
export const updatePriceListItemsApi = (id:number, items:object[]) => client.put<ApiResponse<null>>(`/price-lists/${id}/items`, { items })
export const getCustomerPriceApi     = (customerId:number, productId:number) => client.get<ApiResponse<{salePrice:number}|null>>('/price-lists/customer-price', { params:{customerId,productId} })
export const bindCustomerApi         = (customerId:number, priceListId:number|null) => client.put<ApiResponse<null>>('/price-lists/bind-customer', { customerId, priceListId })
