import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getLocationsApi,
  getLocationsByWarehouseApi,
  createLocationApi,
  updateLocationApi,
  deleteLocationApi,
} from '@/api/locations'
import type { QueryParams } from '@/types'
import type { CreateLocationParams, UpdateLocationParams } from '@/types/locations'

const QUERY_KEY = 'locations'

export function useLocations(params: QueryParams & { warehouseId?: number; zone?: string }) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getLocationsApi(params),
  })
}

export function useLocationsByWarehouse(warehouseId: number | null) {
  return useQuery({
    queryKey: [QUERY_KEY, 'by-warehouse', warehouseId],
    queryFn: () => getLocationsByWarehouseApi(warehouseId!),
    enabled: !!warehouseId,
    staleTime: 1000 * 60 * 5,
  })
}

export function useCreateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLocationParams) => createLocationApi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useUpdateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateLocationParams }) =>
      updateLocationApi(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useDeleteLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteLocationApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}
