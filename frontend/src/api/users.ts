import { payloadClient as apiClient } from './client'
import type { PaginatedData, QueryParams } from '@/types'
import type { SysUser, CreateUserParams, UpdateUserParams } from '@/types/users'

export async function getUsersApi(params: QueryParams): Promise<PaginatedData<SysUser>> {
  const res = await apiClient.get<PaginatedData<SysUser>>('/users', { params })
  return res
}

export interface UserOption {
  id: number
  realName: string
  isActive: boolean
}

/** 精简用户列表：仅供下拉选择（如采购单"经办人"筛选），不受 user.view 权限限制 */
export async function getUserOptionsApi(): Promise<UserOption[]> {
  const res = await apiClient.get<UserOption[]>('/users/options')
  return res
}

export async function createUserApi(data: CreateUserParams): Promise<{ id: number }> {
  const res = await apiClient.post<{ id: number }>('/users', data)
  return res
}

export interface MyInfo {
  id: number
  username: string
  realName: string
  roleId: number
  roleName: string
  isActive: boolean
  departmentId: number | null
  departmentName: string | null
  createdAt: string
}

/** 当前登录用户信息（UserMenu 头像/姓名用，仅需登录态） */
export async function getMyInfoApi(id: number): Promise<MyInfo | null> {
  const res = await apiClient.get<MyInfo>(`/users/${id}`)
  return res ?? null
}

export interface WarehouseScopeItem {
  warehouseId: number
  warehouseName?: string
  [key: string]: unknown
}

/** 当前用户仓库范围（UserMenu 展示限仓信息用） */
export async function getMyWarehouseScopeApi(id: number): Promise<WarehouseScopeItem[]> {
  const res = await apiClient.get<WarehouseScopeItem[]>(`/users/${id}/warehouse-scope`)
  return res ?? []
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
