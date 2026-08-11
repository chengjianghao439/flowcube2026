import { payloadClient as apiClient } from './client'

import type { Category, CreateCategoryParams, UpdateCategoryParams } from '@/types/categories'

const BASE = '/categories'

export const getCategoryTreeApi   = async () => apiClient.get<Category[]>(`${BASE}/tree`)
export const getCategoryFlatApi   = async () => apiClient.get<Category[]>(`${BASE}/flat`)
export const getCategoryLeavesApi = async () => apiClient.get<Category[]>(`${BASE}/leaves`)

export const createCategoryApi = async (d: CreateCategoryParams) =>
  apiClient.post<{ id: number }>(`${BASE}`, d)

export const updateCategoryApi = async (id: number, d: UpdateCategoryParams) => {
  await apiClient.put(`${BASE}/${id}`, d)
}

export const deleteCategoryApi = async (id: number) => {
  await apiClient.delete(`${BASE}/${id}`)
}

export const toggleCategoryStatusApi = async (id: number, status: boolean) => {
  await apiClient.patch(`${BASE}/${id}/status`, { status })
}
