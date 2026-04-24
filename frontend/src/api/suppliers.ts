import { payloadClient as apiClient } from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { Supplier, SupplierOption, CreateSupplierParams, UpdateSupplierParams } from '@/types/suppliers'

export const getSuppliersApi   = async (p: QueryParams) => apiClient.get<ApiResponse<PaginatedData<Supplier>>>('/suppliers', { params: p })
export const getSuppliersActiveApi = async () => apiClient.get<ApiResponse<SupplierOption[]>>('/suppliers/active')
export const createSupplierApi = async (d: CreateSupplierParams) => apiClient.post<ApiResponse<{id:number}>>('/suppliers', d)
export const updateSupplierApi = async (id: number, d: UpdateSupplierParams) => { await apiClient.put(`/suppliers/${id}`, d) }
export const deleteSupplierApi = async (id: number) => { await apiClient.delete(`/suppliers/${id}`) }
