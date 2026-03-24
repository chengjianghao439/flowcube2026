import apiClient from './client'
import type { ApiResponse } from '@/types'
import type { Category, CreateCategoryParams, UpdateCategoryParams } from '@/types/categories'

const BASE = '/categories'

export const getCategoryTreeApi   = async () => (await apiClient.get<ApiResponse<Category[]>>(`${BASE}/tree`)).data.data
export const getCategoryFlatApi   = async () => (await apiClient.get<ApiResponse<Category[]>>(`${BASE}/flat`)).data.data
export const getCategoryLeavesApi = async () => (await apiClient.get<ApiResponse<Category[]>>(`${BASE}/leaves`)).data.data

export const createCategoryApi = async (d: CreateCategoryParams) =>
  (await apiClient.post<ApiResponse<{ id: number }>>(`${BASE}`, d)).data.data

export const updateCategoryApi = async (id: number, d: UpdateCategoryParams) => {
  await apiClient.put(`${BASE}/${id}`, d)
}

export const deleteCategoryApi = async (id: number) => {
  await apiClient.delete(`${BASE}/${id}`)
}

export const toggleCategoryStatusApi = async (id: number, status: boolean) => {
  await apiClient.patch(`${BASE}/${id}/status`, { status })
}
