import apiClient from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { Rack, CreateRackParams, UpdateRackParams } from '@/types/racks'

export async function getRacksApi(
  params: QueryParams & { warehouseId?: number; zone?: string },
): Promise<PaginatedData<Rack>> {
  const res = await apiClient.get<ApiResponse<PaginatedData<Rack>>>('/racks', { params })
  return res.data.data
}

export async function getRacksActiveApi(warehouseId?: number): Promise<Rack[]> {
  const res = await apiClient.get<ApiResponse<Rack[]>>('/racks/active', {
    params: warehouseId ? { warehouseId } : {},
  })
  return res.data.data
}

export async function getRackByIdApi(id: number): Promise<Rack> {
  const res = await apiClient.get<ApiResponse<Rack>>(`/racks/${id}`)
  return res.data.data
}

export async function createRackApi(data: CreateRackParams): Promise<Rack> {
  const res = await apiClient.post<ApiResponse<Rack>>('/racks', data)
  return res.data.data
}

export async function updateRackApi(id: number, data: UpdateRackParams): Promise<Rack> {
  const res = await apiClient.put<ApiResponse<Rack>>(`/racks/${id}`, data)
  return res.data.data
}

export async function deleteRackApi(id: number): Promise<void> {
  await apiClient.delete(`/racks/${id}`)
}
