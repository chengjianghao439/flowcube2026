import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getWarehousesApi,
  getWarehousesActiveApi,
  createWarehouseApi,
  updateWarehouseApi,
  deleteWarehouseApi,
} from '@/api/warehouses'
import type { QueryParams } from '@/types'
import type { CreateWarehouseParams, UpdateWarehouseParams } from '@/types/warehouses'

const QUERY_KEY = 'warehouses'

export function useWarehouses(params: QueryParams) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getWarehousesApi(params),
  })
}

export function useWarehousesActive() {
  return useQuery({
    queryKey: [QUERY_KEY, 'active'],
    queryFn: getWarehousesActiveApi,
    staleTime: 1000 * 60 * 10,
  })
}

export function useCreateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateWarehouseParams) => createWarehouseApi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useUpdateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateWarehouseParams }) =>
      updateWarehouseApi(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useDeleteWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteWarehouseApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}
