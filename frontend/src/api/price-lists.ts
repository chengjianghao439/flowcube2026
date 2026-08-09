import { payloadClient as client } from './client'

export interface CustomerResolvedPrice { salePrice:number; priceLevel:string; priceLevelName:string }

export const getCustomerPriceApi     = (customerId:number, productId:number) => client.get<CustomerResolvedPrice|null>('/price-lists/customer-price', { params:{customerId,productId} })
export const bindCustomerApi         = (customerId:number, priceLevel:'A'|'B'|'C'|'D', config?: Parameters<typeof client.put>[2]) => client.put<null>('/price-lists/bind-customer', { customerId, priceLevel }, config)
