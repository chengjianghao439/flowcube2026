import { payloadClient as apiClient } from './client'
import type { PaginatedData, QueryParams } from '@/types'
import type { Supplier, SupplierOption, CreateSupplierParams, UpdateSupplierParams } from '@/types/suppliers'

export const getSuppliersApi   = async (p: QueryParams, config?: Parameters<typeof apiClient.get>[1]) => apiClient.get<PaginatedData<Supplier>>('/suppliers', { ...config, params: p })
export const getSuppliersActiveApi = async () => apiClient.get<SupplierOption[]>('/suppliers/active')
export const createSupplierApi = async (d: CreateSupplierParams) => apiClient.post<{id:number}>('/suppliers', d, { skipGlobalError: true })
export const updateSupplierApi = async (id: number, d: UpdateSupplierParams) => { await apiClient.put(`/suppliers/${id}`, d, { skipGlobalError: true }) }
export const deleteSupplierApi = async (id: number, config?: Parameters<typeof apiClient.delete>[1]) => { await apiClient.delete(`/suppliers/${id}`, config) }
