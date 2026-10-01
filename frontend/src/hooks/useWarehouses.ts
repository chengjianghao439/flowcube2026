import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from './useKits'
import { commercialReadConfig } from '@/api/sale-commercial'
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
import { toast } from '@/lib/toast'

const QUERY_KEY = 'warehouses'

export function useWarehouses(params: QueryParams) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getWarehousesApi(params),
  })
}

export function useWarehousesActive(readOwner?: KitReadOwner) {
  return useQuery({
    queryKey: readOwner ? [QUERY_KEY, 'active', readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration] : [QUERY_KEY, 'active'],
    queryFn: async () => {
      if (!readOwner) return getWarehousesActiveApi()
      assertKitReadOwner(readOwner)
      const data = await getWarehousesActiveApi(commercialReadConfig(readOwner))
      assertKitReadOwner(readOwner)
      return data
    },
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
    mutationFn: (id: number) => deleteWarehouseApi(id, { skipGlobalError: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })
}
