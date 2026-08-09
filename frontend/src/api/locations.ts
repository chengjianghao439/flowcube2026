import { payloadClient as apiClient } from './client'
import type { PaginatedData, QueryParams } from '@/types'
import type { Location, CreateLocationParams, UpdateLocationParams } from '@/types/locations'

export async function getLocationsApi(
  params: QueryParams & { warehouseId?: number; zone?: string },
): Promise<PaginatedData<Location>> {
  const res = await apiClient.get<PaginatedData<Location>>('/locations', { params })
  return res
}

export async function createLocationApi(data: CreateLocationParams, config?: Parameters<typeof apiClient.post>[2]): Promise<{ id: number }> {
  const res = await apiClient.post<{ id: number }>('/locations', data, config)
  return res
}

export async function updateLocationApi(id: number, data: UpdateLocationParams, config?: Parameters<typeof apiClient.put>[2]): Promise<void> {
  await apiClient.put(`/locations/${id}`, data, config)
}

export async function deleteLocationApi(id: number, config?: Parameters<typeof apiClient.delete>[1]): Promise<void> {
  await apiClient.delete(`/locations/${id}`, config)
}
