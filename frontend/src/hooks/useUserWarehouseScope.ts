import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payloadClient as client } from '@/api/client'

export const USER_WAREHOUSE_SCOPE_QUERY_KEY = 'user-warehouse-scope'

export interface UserWarehouseScopeRow {
  warehouseId: number
  warehouseName: string
}

export function getUserWarehouseScopeApi(userId: number) {
  return client.get<UserWarehouseScopeRow[]>(`/users/${userId}/warehouse-scope`)
}
export function saveUserWarehouseScopeApi(userId: number, warehouseIds: number[]) {
  return client.put(`/users/${userId}/warehouse-scope`, { warehouseIds })
}

export function useUserWarehouseScope(userId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: [USER_WAREHOUSE_SCOPE_QUERY_KEY, userId],
    queryFn: () => getUserWarehouseScopeApi(userId!),
    enabled: enabled && !!userId,
  })
}

export function useSaveUserWarehouseScope(userId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (warehouseIds: number[]) => saveUserWarehouseScopeApi(userId!, warehouseIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [USER_WAREHOUSE_SCOPE_QUERY_KEY, userId] })
    },
  })
}
