import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { Carrier, CarrierOption, CreateCarrierParams, UpdateCarrierParams } from '@/types/carriers'

export const getCarriersApi       = (params: object)                      => client.get<PaginatedData<Carrier>>('/carriers', { params })
export const getCarriersActiveApi = ()                                     => client.get<CarrierOption[]>('/carriers/active')
export const createCarrierApi     = (data: CreateCarrierParams, config?: Parameters<typeof client.post>[2]) => client.post<{ id: number }>('/carriers', data, config)
export const updateCarrierApi     = (id: number, data: UpdateCarrierParams, config?: Parameters<typeof client.put>[2]) => client.put<null>(`/carriers/${id}`, data, config)
export const deleteCarrierApi     = (id: number, config?: Parameters<typeof client.delete>[1]) => client.delete<null>(`/carriers/${id}`, config)

export const getCarrierAccountBindingApi = (id: number, platform: 'sf' | 'deppon') => client.get<import('@/types/carriers').CarrierAccountBinding>(`/carriers/${id}/account-binding`, { params: { platform } })
export const saveCarrierAccountBindingApi = (id: number, data: import('@/types/carriers').SaveCarrierAccountBinding | import('@/types/carriers').PauseCarrierAccountBinding) => client.put<import('@/types/carriers').CarrierAccountBinding>(`/carriers/${id}/account-binding`, data, { skipGlobalError: true })

export const createCarrierAccountApi = (data: import('@/types/carriers').NewCarrierAccount, requestKey: string) => client.post<{ id: number }>('/carriers/account-bindings', data, { headers: { 'X-Request-Key': requestKey }, skipGlobalError: true })
