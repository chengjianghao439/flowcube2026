import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { Carrier, CarrierOption, CreateCarrierParams, UpdateCarrierParams } from '@/types/carriers'

export const getCarriersApi       = (params: object)                      => client.get<PaginatedData<Carrier>>('/carriers', { params })
export const getCarriersActiveApi = ()                                     => client.get<CarrierOption[]>('/carriers/active')
export const getCarrierDetailApi  = (id: number)                          => client.get<Carrier>(`/carriers/${id}`)
export const createCarrierApi     = (data: CreateCarrierParams)           => client.post<{ id: number }>('/carriers', data)
export const updateCarrierApi     = (id: number, data: UpdateCarrierParams) => client.put<null>(`/carriers/${id}`, data)
export const deleteCarrierApi     = (id: number)                          => client.delete<null>(`/carriers/${id}`)
