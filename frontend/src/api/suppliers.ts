import apiClient from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { Supplier, SupplierOption, CreateSupplierParams, UpdateSupplierParams } from '@/types/suppliers'

export const getSuppliersApi   = async (p: QueryParams) => (await apiClient.get<ApiResponse<PaginatedData<Supplier>>>('/suppliers', { params: p })).data.data
export const getSuppliersActiveApi = async () => (await apiClient.get<ApiResponse<SupplierOption[]>>('/suppliers/active')).data.data
export const createSupplierApi = async (d: CreateSupplierParams) => (await apiClient.post<ApiResponse<{id:number}>>('/suppliers', d)).data.data
export const updateSupplierApi = async (id: number, d: UpdateSupplierParams) => { await apiClient.put(`/suppliers/${id}`, d) }
export const deleteSupplierApi = async (id: number) => { await apiClient.delete(`/suppliers/${id}`) }
