import { payloadClient as client } from './client'
import type { CustomerAddress, CustomerAddressWritable, CreateCustomerAddressParams } from '@/types/customers'

export const getCustomerAddressesApi = (customerId: number) =>
  client.get<CustomerAddress[]>('/customer-addresses', { params: { customerId } })
export const createCustomerAddressApi = (data: CreateCustomerAddressParams, config?: Parameters<typeof client.post>[2]) =>
  client.post<{ id: number }>('/customer-addresses', data, config)
export const updateCustomerAddressApi = (id: number, data: CustomerAddressWritable, config?: Parameters<typeof client.put>[2]) =>
  client.put<null>(`/customer-addresses/${id}`, data, config)
export const setDefaultCustomerAddressApi = (id: number, config?: Parameters<typeof client.put>[2]) =>
  client.put<null>(`/customer-addresses/${id}/default`, {}, config)
export const deleteCustomerAddressApi = (id: number, config?: Parameters<typeof client.delete>[1]) =>
  client.delete<null>(`/customer-addresses/${id}`, config)
