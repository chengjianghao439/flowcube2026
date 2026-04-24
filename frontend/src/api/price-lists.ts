import { payloadClient as client } from './client'

export interface PriceList { id:number; name:string; remark?:string; isActive:number; createdAt:string }
export interface PriceListItem { id:number; productId:number; productCode:string; productName:string; unit:string; salePrice:number }
export interface CustomerResolvedPrice { salePrice:number; priceLevel:string; priceLevelName:string }

export const getPriceListsApi   = () => client.get<PriceList[]>('/price-lists')
export const createPriceListApi = (d:{name:string;remark?:string}) => client.post<{id:number}>('/price-lists', d)
export const updatePriceListApi = (id:number, d:object) => client.put<null>(`/price-lists/${id}`, d)
export const deletePriceListApi = (id:number) => client.delete<null>(`/price-lists/${id}`)
export const getPriceListItemsApi    = (id:number) => client.get<PriceListItem[]>(`/price-lists/${id}/items`)
export const updatePriceListItemsApi = (id:number, items:object[]) => client.put<null>(`/price-lists/${id}/items`, { items })
export const getCustomerPriceApi     = (customerId:number, productId:number) => client.get<CustomerResolvedPrice|null>('/price-lists/customer-price', { params:{customerId,productId} })
export const bindCustomerApi         = (customerId:number, priceLevel:'A'|'B'|'C'|'D') => client.put<null>('/price-lists/bind-customer', { customerId, priceLevel })
