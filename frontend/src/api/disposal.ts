import type { AxiosRequestConfig } from 'axios'
import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type {
  DisposalOrder,
  DisposalSuggestion,
  DisposalSuggestionParams,
  CreateDisposalParams,
  DisposalExecutionResult,
} from '@/types/disposal'

export const getDisposalSuggestionsApi = (params: DisposalSuggestionParams, config?: AxiosRequestConfig) =>
  client.get<PaginatedData<DisposalSuggestion>>('/disposals/suggestions', { ...config, params })

export const getDisposalListApi = (params: object, config?: AxiosRequestConfig) =>
  client.get<PaginatedData<DisposalOrder>>('/disposals', { ...config, params })

export const getDisposalDetailApi = (id: number, config?: AxiosRequestConfig) =>
  client.get<DisposalOrder>(`/disposals/${id}`, config)

export const createDisposalApi = (data: CreateDisposalParams, config?: AxiosRequestConfig) =>
  client.post<{ id: number; disposalNo: string }>('/disposals', data, config)

export const submitDisposalApi = (id: number) =>
  client.post<null>(`/disposals/${id}/submit`)

export const approveDisposalApi = (id: number) =>
  client.post<null>(`/disposals/${id}/approve`)

export const rejectDisposalApi = (id: number, reason?: string) =>
  client.post<null>(`/disposals/${id}/reject`, { reason })

export const disposeDisposalApi = (id: number, requestKey: string, config?: AxiosRequestConfig) =>
  client.post<DisposalExecutionResult>(`/disposals/${id}/dispose`, {}, { ...config, automaticReplay: false, _erpApiFallbackTried: true, skipGlobalError: true, headers: { ...config?.headers, 'X-Request-Key': requestKey } })

export const cancelDisposalApi = (id: number) =>
  client.post<null>(`/disposals/${id}/cancel`)
