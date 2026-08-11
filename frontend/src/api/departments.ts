import { payloadClient as apiClient } from './client'
import type { Department } from '@/types/department'

export const listDepartmentsApi = () => apiClient.get<Department[]>('/departments')

export const listDepartmentOptionsApi = () => apiClient.get<Array<{ id: number; name: string }>>('/departments/options')

export const createDepartmentApi = (d: Partial<Omit<Department, 'id' | 'createdAt'>>) =>
  apiClient.post<{ id: number }>('/departments', d)

export const updateDepartmentApi = (id: number, d: Partial<Omit<Department, 'id' | 'createdAt'>>) =>
  apiClient.put<null>(`/departments/${id}`, d)

export const deleteDepartmentApi = (id: number) => apiClient.delete<null>(`/departments/${id}`)
