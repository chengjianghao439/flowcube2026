import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCarriersApi, getCarriersActiveApi, createCarrierApi, updateCarrierApi, deleteCarrierApi } from '@/api/carriers'
import type { CreateCarrierParams, UpdateCarrierParams } from '@/types/carriers'

export const useCarriers       = (params: object) => useQuery({ queryKey: ['carriers', params], queryFn: () => getCarriersApi(params) })
export const useCarriersActive = ()               => useQuery({ queryKey: ['carriers-active'],  queryFn: () => getCarriersActiveApi().then(r => r || []) })
export const useCreateCarrier  = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (data: CreateCarrierParams)                         => createCarrierApi(data),       onSuccess: () => { qc.invalidateQueries({ queryKey: ['carriers'] }); qc.invalidateQueries({ queryKey: ['carriers-active'] }) } }) }
export const useUpdateCarrier  = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, data }: { id: number; data: UpdateCarrierParams }) => updateCarrierApi(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['carriers'] }); qc.invalidateQueries({ queryKey: ['carriers-active'] }) } }) }
export const useDeleteCarrier  = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number)                                        => deleteCarrierApi(id),         onSuccess: () => { qc.invalidateQueries({ queryKey: ['carriers'] }); qc.invalidateQueries({ queryKey: ['carriers-active'] }) } }) }
