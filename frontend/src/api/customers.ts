import { payloadClient as client } from './client'
import type { ApiResponse, PaginatedData } from '@/types'
import type { Customer, CustomerOption, CreateCustomerParams, UpdateCustomerParams } from '@/types/customers'
export const getCustomersApi = (params: object) => client.get<ApiResponse<PaginatedData<Customer>>>('/customers', { params })
export const getCustomersActiveApi = () => client.get<ApiResponse<CustomerOption[]>>('/customers/active')
export const createCustomerApi = (data: CreateCustomerParams) => client.post<ApiResponse<{ id: number }>>('/customers', data)
export const updateCustomerApi = (id: number, data: UpdateCustomerParams) => client.put<ApiResponse<null>>(`/customers/${id}`, data)
export const deleteCustomerApi = (id: number) => client.delete<ApiResponse<null>>(`/customers/${id}`)
