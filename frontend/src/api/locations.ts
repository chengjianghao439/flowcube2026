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

/** 按库位条码查库位（PDA 扫码库位确认用），查不到返回 null */
export async function getLocationByCodeApi(code: string, config?: Parameters<typeof apiClient.get>[1]): Promise<{ id: number; code: string } | null> {
  const res = await apiClient.get<{ id: number; code: string }>(`/locations/code/${encodeURIComponent(code)}`, config)
  return res ?? null
}
