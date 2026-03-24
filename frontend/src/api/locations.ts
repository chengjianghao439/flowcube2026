import apiClient from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { Location, CreateLocationParams, UpdateLocationParams } from '@/types/locations'

export async function getLocationsApi(
  params: QueryParams & { warehouseId?: number; zone?: string },
): Promise<PaginatedData<Location>> {
  const res = await apiClient.get<ApiResponse<PaginatedData<Location>>>('/locations', { params })
  return res.data.data
}

export async function getLocationByIdApi(id: number): Promise<Location> {
  const res = await apiClient.get<ApiResponse<Location>>(`/locations/${id}`)
  return res.data.data
}

export async function getLocationsByWarehouseApi(warehouseId: number): Promise<Location[]> {
  const res = await apiClient.get<ApiResponse<Location[]>>(`/locations/by-warehouse/${warehouseId}`)
  return res.data.data
}

export async function createLocationApi(data: CreateLocationParams): Promise<{ id: number }> {
  const res = await apiClient.post<ApiResponse<{ id: number }>>('/locations', data)
  return res.data.data
}

export async function updateLocationApi(id: number, data: UpdateLocationParams): Promise<void> {
  await apiClient.put(`/locations/${id}`, data)
}

export async function deleteLocationApi(id: number): Promise<void> {
  await apiClient.delete(`/locations/${id}`)
}
