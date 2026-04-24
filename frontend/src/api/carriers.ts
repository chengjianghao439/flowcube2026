import { payloadClient as client } from './client'
import type { ApiResponse, PaginatedData } from '@/types'
import type { Carrier, CarrierOption, CreateCarrierParams, UpdateCarrierParams } from '@/types/carriers'

export const getCarriersApi       = (params: object)                      => client.get<ApiResponse<PaginatedData<Carrier>>>('/carriers', { params })
export const getCarriersActiveApi = ()                                     => client.get<ApiResponse<CarrierOption[]>>('/carriers/active')
export const getCarrierDetailApi  = (id: number)                          => client.get<ApiResponse<Carrier>>(`/carriers/${id}`)
export const createCarrierApi     = (data: CreateCarrierParams)           => client.post<ApiResponse<{ id: number }>>('/carriers', data)
export const updateCarrierApi     = (id: number, data: UpdateCarrierParams) => client.put<ApiResponse<null>>(`/carriers/${id}`, data)
export const deleteCarrierApi     = (id: number)                          => client.delete<ApiResponse<null>>(`/carriers/${id}`)
