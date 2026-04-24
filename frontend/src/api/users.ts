import { payloadClient as apiClient } from './client'
import type { PaginatedData, QueryParams } from '@/types'
import type { SysUser, CreateUserParams, UpdateUserParams } from '@/types/users'

export async function getUsersApi(params: QueryParams): Promise<PaginatedData<SysUser>> {
  const res = await apiClient.get<PaginatedData<SysUser>>('/users', { params })
  return res
}

export async function getUserApi(id: number): Promise<SysUser> {
  const res = await apiClient.get<SysUser>(`/users/${id}`)
  return res
}

export async function createUserApi(data: CreateUserParams): Promise<{ id: number }> {
  const res = await apiClient.post<{ id: number }>('/users', data)
  return res
}

export async function updateUserApi(id: number, data: UpdateUserParams): Promise<void> {
  await apiClient.put(`/users/${id}`, data)
}

export async function resetPasswordApi(id: number, newPassword: string): Promise<void> {
  await apiClient.put(`/users/${id}/password`, { newPassword })
}

export async function deleteUserApi(id: number): Promise<void> {
  await apiClient.delete(`/users/${id}`)
}
