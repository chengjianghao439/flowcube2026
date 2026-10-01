import { payloadClient as client } from './client'

export interface CustomerResolvedPrice {
  salePrice: number
  priceLevel: string | null
  priceLevelName: string
  source?: 'price_list' | 'price_level' // 兼容旧响应；缺失时不推断价格表或等级
  priceListId?: number
}

export const getCustomerPriceApi     = (customerId:number, productId:number) => client.get<CustomerResolvedPrice|null>('/price-lists/customer-price', { params:{customerId,productId} })
export const bindCustomerApi         = (customerId:number, priceLevel:'A'|'B'|'C'|'D', config?: Parameters<typeof client.put>[2]) => client.put<null>('/price-lists/bind-customer', { customerId, priceLevel }, config)
