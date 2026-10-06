import type { AxiosRequestConfig } from 'axios'
import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { HandlingSource, ConversionSnapshot, HandlingAck } from '@/types/disposal-handling'
export const getHandlingSourcesApi = (params: object, config?: AxiosRequestConfig) => client.get<PaginatedData<HandlingSource>>('/disposals/handling-sources', { ...config, params, listMode: 'paged' })
export const getHandlingSourceApi = (id: number, config?: AxiosRequestConfig) => client.get<HandlingSource>(`/disposals/handling-sources/${id}`, config)
export const getConversionSnapshotApi = (id: number, config?: AxiosRequestConfig) => client.get<ConversionSnapshot>(`/disposals/${id}/conversion-snapshot`, config)
export const getOwnHandlingOperationApi = (uuid: string, params: { action: string; requestKey: string; intentUuid?: string }, config?: AxiosRequestConfig) => client.get<{ status: 'success' | 'pending' | 'not_found'; data: HandlingAck | null; resourceType?: string; resourceId?: number }>(`/disposals/handling-operations/${uuid}`, { ...config, params })
export const postHandlingApi = (path: string, body: object, key: string, config?: AxiosRequestConfig) => client.post<HandlingAck>(path, body, { ...config, headers: { ...config?.headers, 'X-Request-Key': key }, automaticReplay: false, _erpApiFallbackTried: true, skipGlobalError: true })
