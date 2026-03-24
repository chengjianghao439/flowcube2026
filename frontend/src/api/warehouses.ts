import apiClient from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { Warehouse, WarehouseOption, CreateWarehouseParams, UpdateWarehouseParams } from '@/types/warehouses'

export async function getWarehousesApi(params: QueryParams): Promise<PaginatedData<Warehouse>> {
  const res = await apiClient.get<ApiResponse<PaginatedData<Warehouse>>>('/warehouses', { params })
  return res.data.data
}

export async function getWarehousesActiveApi(): Promise<WarehouseOption[]> {
  const res = await apiClient.get<ApiResponse<WarehouseOption[]>>('/warehouses/active')
  return res.data.data
}

export async function createWarehouseApi(data: CreateWarehouseParams): Promise<{ id: number }> {
  const res = await apiClient.post<ApiResponse<{ id: number }>>('/warehouses', data)
  return res.data.data
}

export async function updateWarehouseApi(id: number, data: UpdateWarehouseParams): Promise<void> {
  await apiClient.put(`/warehouses/${id}`, data)
}

export async function deleteWarehouseApi(id: number): Promise<void> {
  await apiClient.delete(`/warehouses/${id}`)
}
