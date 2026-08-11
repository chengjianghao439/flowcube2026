import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { Customer, CreateCustomerParams, UpdateCustomerParams } from '@/types/customers'
export const getCustomersApi = (params: object) => client.get<PaginatedData<Customer>>('/customers', { params })
export const createCustomerApi = (data: CreateCustomerParams, config?: Parameters<typeof client.post>[2]) => client.post<{ id: number }>('/customers', data, config)
export const updateCustomerApi = (id: number, data: UpdateCustomerParams, config?: Parameters<typeof client.put>[2]) => client.put<null>(`/customers/${id}`, data, config)
export const deleteCustomerApi = (id: number, config?: Parameters<typeof client.delete>[1]) => client.delete<null>(`/customers/${id}`, config)
