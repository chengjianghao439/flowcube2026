import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type {
  DisposalOrder,
  DisposalSuggestion,
  DisposalSuggestionParams,
  CreateDisposalParams,
} from '@/types/disposal'

export const getDisposalSuggestionsApi = (params: DisposalSuggestionParams) =>
  client.get<PaginatedData<DisposalSuggestion>>('/disposals/suggestions', { params })

export const getDisposalListApi = (params: object) =>
  client.get<PaginatedData<DisposalOrder>>('/disposals', { params })

export const getDisposalDetailApi = (id: number) =>
  client.get<DisposalOrder>(`/disposals/${id}`)

export const createDisposalApi = (data: CreateDisposalParams) =>
  client.post<{ id: number; disposalNo: string }>('/disposals', data)

export const updateDisposalApi = (id: number, data: CreateDisposalParams) =>
  client.put<{ id: number }>(`/disposals/${id}`, data)

export const submitDisposalApi = (id: number) =>
  client.post<null>(`/disposals/${id}/submit`)

export const approveDisposalApi = (id: number) =>
  client.post<null>(`/disposals/${id}/approve`)

export const rejectDisposalApi = (id: number, reason?: string) =>
  client.post<null>(`/disposals/${id}/reject`, { reason })

export const disposeDisposalApi = (id: number) =>
  client.post<{ id: number; disposalNo: string; disposedValue: number }>(`/disposals/${id}/dispose`)

export const cancelDisposalApi = (id: number) =>
  client.post<null>(`/disposals/${id}/cancel`)
