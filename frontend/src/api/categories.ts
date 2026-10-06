import { payloadClient as apiClient } from './client'

import type { Category, CreateCategoryParams, UpdateCategoryParams } from '@/types/categories'

const BASE = '/categories'

export const getCategoryTreeApi = async (config?: Parameters<typeof apiClient.get>[1]) => config === undefined
  ? apiClient.get<Category[]>(`${BASE}/tree`)
  : apiClient.get<Category[]>(`${BASE}/tree`, config)

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
