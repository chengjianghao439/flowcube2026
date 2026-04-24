import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { Customer, CustomerOption, CreateCustomerParams, UpdateCustomerParams } from '@/types/customers'
export const getCustomersApi = (params: object) => client.get<PaginatedData<Customer>>('/customers', { params })
export const getCustomersActiveApi = () => client.get<CustomerOption[]>('/customers/active')
export const createCustomerApi = (data: CreateCustomerParams) => client.post<{ id: number }>('/customers', data)
export const updateCustomerApi = (id: number, data: UpdateCustomerParams) => client.put<null>(`/customers/${id}`, data)
export const deleteCustomerApi = (id: number) => client.delete<null>(`/customers/${id}`)
