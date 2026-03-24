import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getRacksApi,
  getRacksActiveApi,
  createRackApi,
  updateRackApi,
  deleteRackApi,
} from '@/api/racks'
import type { QueryParams } from '@/types'
import type { CreateRackParams, UpdateRackParams } from '@/types/racks'

const QUERY_KEY = 'racks'

export function useRacks(params: QueryParams & { warehouseId?: number; zone?: string }) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getRacksApi(params),
  })
}

export function useRacksActive(warehouseId?: number) {
  return useQuery({
    queryKey: [QUERY_KEY, 'active', warehouseId],
    queryFn: () => getRacksActiveApi(warehouseId),
    staleTime: 1000 * 60 * 5,
  })
}

export function useCreateRack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRackParams) => createRackApi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useUpdateRack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateRackParams }) =>
      updateRackApi(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useDeleteRack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteRackApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}
