import rawApiClient, { payloadClient as apiClient } from './client'
import { collectAllRecords } from './allRecords'
import { useAuthStore } from '@/store/authStore'
import type { PaginatedData, QueryParams } from '@/types'
import type { SysUser, CreateUserParams, UpdateUserParams } from '@/types/users'

export async function getUsersApi(params: QueryParams, mode: 'paged' | 'all' = 'paged', signal?: AbortSignal): Promise<PaginatedData<SysUser>> {
  // 管理列表显式取齐；其它选择器保留原单批读取及后端范围过滤。
  const hideDevelopment = params.hideDevelopment === '0' ? '0' : '1'
  if (mode === 'paged') return apiClient.get<PaginatedData<SysUser>>('/users', { params: { ...params, hideDevelopment }, listMode: 'summary', ...(signal ? { signal } : {}) })
  const auth = useAuthStore.getState()
  const owner = { baseURL: rawApiClient.defaults.baseURL ?? '/api', sessionGeneration: auth.sessionGeneration, userId: auth.user?.id ?? null }
  const fixedParams = { ...params, hideDevelopment }
  const assertOwner = () => {
    const current = useAuthStore.getState()
    if (current.sessionGeneration !== owner.sessionGeneration || (current.user?.id ?? null) !== owner.userId) throw new Error('登录账号或登录状态已变化，请重新读取用户列表')
    if ((rawApiClient.defaults.baseURL ?? '/api') !== owner.baseURL) throw new Error('服务器已切换，请重新读取用户列表')
  }
  return collectAllRecords(async (page, pageSize = 200, snapshotId) => {
    assertOwner()
    const result = await apiClient.get<PaginatedData<SysUser>>('/users', { params: { ...fixedParams, page, pageSize, ...(snapshotId ? { snapshotId } : {}) }, baseURL: owner.baseURL, _authSessionGeneration: owner.sessionGeneration, _erpApiFallbackTried: true, listMode: 'paged', ...(signal ? { signal } : {}) })
    assertOwner()
    return result
  }, signal)
}

export interface UserOption {
  id: number
  realName: string
  isActive: boolean
}

/** 精简用户列表：仅供下拉选择（如采购单"经办人"筛选），不受 user.view 权限限制 */
export async function getUserOptionsApi(): Promise<UserOption[]> {
  const res = await apiClient.get<UserOption[]>('/users/options', { params: { hideDevelopment: '1' } })
  return res
}

export async function createUserApi(data: CreateUserParams): Promise<{ id: number }> {
  const res = await apiClient.post<{ id: number }>('/users', data, { skipGlobalError: true })
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
export async function getMyInfoApi(): Promise<MyInfo | null> {
  const res = await apiClient.get<MyInfo>('/users/me')
  return res ?? null
}

export interface WarehouseScopeItem {
  warehouseId: number
  warehouseName?: string
  [key: string]: unknown
}

/** 当前用户仓库范围（UserMenu 展示限仓信息用） */
export async function getMyWarehouseScopeApi(): Promise<WarehouseScopeItem[]> {
  const res = await apiClient.get<WarehouseScopeItem[]>('/users/me/warehouse-scope')
  return res ?? []
}

export async function updateUserApi(id: number, data: UpdateUserParams): Promise<void> {
  await apiClient.put(`/users/${id}`, data, { skipGlobalError: true })
}

export async function resetPasswordApi(id: number, newPassword: string): Promise<void> {
  await apiClient.put(`/users/${id}/password`, { newPassword }, { skipGlobalError: true })
}

export async function deleteUserApi(id: number): Promise<void> {
  await apiClient.delete(`/users/${id}`)
}

export const getAssignableRolesApi = () => apiClient.get<{ id: number; code: string; name: string }[]>('/users/assignable-roles')
