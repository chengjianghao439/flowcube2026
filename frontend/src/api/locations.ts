import { payloadClient as apiClient } from './client'
import type { PaginatedData, QueryParams } from '@/types'
import type { Location, CreateLocationParams, UpdateLocationParams } from '@/types/locations'

export async function getLocationsApi(
  params: QueryParams & { warehouseId?: number; zone?: string },
): Promise<PaginatedData<Location>> {
  const res = await apiClient.get<PaginatedData<Location>>('/locations', { params })
  return res
}

export async function getLocationByIdApi(id: number): Promise<Location> {
  const res = await apiClient.get<Location>(`/locations/${id}`)
  return res
}

export async function getLocationsByWarehouseApi(warehouseId: number): Promise<Location[]> {
  const res = await apiClient.get<Location[]>(`/locations/by-warehouse/${warehouseId}`)
  return res
}

export async function createLocationApi(data: CreateLocationParams): Promise<{ id: number }> {
  const res = await apiClient.post<{ id: number }>('/locations', data)
  return res
}

export async function updateLocationApi(id: number, data: UpdateLocationParams): Promise<void> {
  await apiClient.put(`/locations/${id}`, data)
}

export async function deleteLocationApi(id: number): Promise<void> {
  await apiClient.delete(`/locations/${id}`)
}
