import apiClient, { payloadClient } from './client'
import { collectAllRecords } from './allRecords'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import { useAuthStore } from '@/store/authStore'
import type { PaginatedData } from '@/types'
import type { CreateKitInput, KitDefinition, UpdateKitInput, KitListParams } from '@/types/kits'
export interface KitReadOwner { baseURL: string; sessionGeneration: number; userId: number | null }
export interface KitRequestContext { requestKey: string; baseURL: string; sessionGeneration: number }
function writeConfig(context: KitRequestContext) {
  return { baseURL: context.baseURL, _authSessionGeneration: context.sessionGeneration, _erpApiFallbackTried: true, skipGlobalError: true, headers: withRequestKeyHeaders(context.requestKey) }
}
function readConfig(owner?: KitReadOwner) {
  return { skipGlobalError: true, ...(owner ? { baseURL: owner.baseURL, _authSessionGeneration: owner.sessionGeneration, _erpApiFallbackTried: true } : {}) }
}
function assertListReadOwner(owner: KitReadOwner) {
  const auth = useAuthStore.getState()
  if (!auth.token || auth.user?.id !== owner.userId || auth.sessionGeneration !== owner.sessionGeneration) throw new Error('登录账号或登录状态已变化，当前草稿已保留，请重新打开资料')
  if ((apiClient.defaults.baseURL ?? '/api') !== owner.baseURL) throw new Error('服务器已切换，当前草稿已保留；请回原服务器核对或关闭后重新打开资料')
}
export function getKitsApi(params: KitListParams, signal?: AbortSignal, owner?: KitReadOwner, mode: 'paged' | 'all' = 'paged'): Promise<PaginatedData<KitDefinition>> {
  if (mode === 'all') {
    if (!owner) return Promise.reject(new Error('读取上下文不可用，请重新打开列表'))
    // 本接口严格最多100条；不能走通用客户端的首次200批。
    return collectAllRecords(async (page, pageSize = 100) => {
      assertListReadOwner(owner)
      const result = await getKitsApi({ ...params, page, pageSize }, signal, owner)
      assertListReadOwner(owner)
      return result
    }, signal)
  }
  return payloadClient.get<PaginatedData<KitDefinition>>('/kits', { ...readConfig(owner), params, signal, listMode: 'paged' })
}
export const getKitApi = (id: number, owner?: KitReadOwner) => payloadClient.get<KitDefinition>(`/kits/${id}`, readConfig(owner))
export const createKitApi = (data: CreateKitInput, context: KitRequestContext) => payloadClient.post<KitDefinition>('/kits', data, writeConfig(context))
export const updateKitApi = (id: number, data: UpdateKitInput, context: KitRequestContext) => payloadClient.put<KitDefinition>(`/kits/${id}`, data, writeConfig(context))
export const deleteKitApi = (id: number, data: { revision: number }, context: KitRequestContext) => payloadClient.delete<KitDefinition>(`/kits/${id}`, { ...writeConfig(context), data })
