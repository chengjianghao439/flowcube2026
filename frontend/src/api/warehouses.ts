import { payloadClient as apiClient } from './client'
import type { PaginatedData, QueryParams } from '@/types'
import type { Warehouse, WarehouseOption, CreateWarehouseParams, UpdateWarehouseParams } from '@/types/warehouses'

export async function getWarehousesApi(params: QueryParams): Promise<PaginatedData<Warehouse>> {
  const res = await apiClient.get<PaginatedData<Warehouse>>('/warehouses', { params })
  return res
}

export async function getWarehousesActiveApi(): Promise<WarehouseOption[]> {
  const res = await apiClient.get<WarehouseOption[]>('/warehouses/active')
  return res
}

export async function createWarehouseApi(data: CreateWarehouseParams): Promise<{ id: number }> {
  const res = await apiClient.post<{ id: number }>('/warehouses', data)
  return res
}

export async function updateWarehouseApi(id: number, data: UpdateWarehouseParams): Promise<void> {
  await apiClient.put(`/warehouses/${id}`, data)
}

export async function deleteWarehouseApi(id: number): Promise<void> {
  await apiClient.delete(`/warehouses/${id}`)
}
