import { payloadClient } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
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
export const getKitsApi = (params: KitListParams, signal?: AbortSignal, owner?: KitReadOwner) => payloadClient.get<PaginatedData<KitDefinition>>('/kits', { ...readConfig(owner), params, signal, listMode: 'paged' })
export const getKitApi = (id: number, owner?: KitReadOwner) => payloadClient.get<KitDefinition>(`/kits/${id}`, readConfig(owner))
export const createKitApi = (data: CreateKitInput, context: KitRequestContext) => payloadClient.post<KitDefinition>('/kits', data, writeConfig(context))
export const updateKitApi = (id: number, data: UpdateKitInput, context: KitRequestContext) => payloadClient.put<KitDefinition>(`/kits/${id}`, data, writeConfig(context))
export const deleteKitApi = (id: number, data: { revision: number }, context: KitRequestContext) => payloadClient.delete<KitDefinition>(`/kits/${id}`, { ...writeConfig(context), data })
