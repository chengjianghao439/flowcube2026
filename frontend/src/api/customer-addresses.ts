import { payloadClient as client } from './client'
import type { CustomerAddress, CustomerAddressWritable, CreateCustomerAddressParams } from '@/types/customers'

export const getCustomerAddressesApi = (customerId: number) =>
  client.get<CustomerAddress[]>('/customer-addresses', { params: { customerId } })
export const createCustomerAddressApi = (data: CreateCustomerAddressParams) =>
  client.post<{ id: number }>('/customer-addresses', data)
export const updateCustomerAddressApi = (id: number, data: CustomerAddressWritable) =>
  client.put<null>(`/customer-addresses/${id}`, data)
export const setDefaultCustomerAddressApi = (id: number) =>
  client.put<null>(`/customer-addresses/${id}/default`, {})
export const deleteCustomerAddressApi = (id: number) =>
  client.delete<null>(`/customer-addresses/${id}`)
