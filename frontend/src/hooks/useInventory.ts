import { useVisibleQuery } from './useVisibleQuery'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getStockApi, getLogsApi, inboundApi, outboundApi, adjustApi, getInventoryOverviewApi, getInventoryContainersApi } from '@/api/inventory'
import { useInvalidate } from '@/hooks/useInvalidate'
import type { QueryParams } from '@/types'
import type { StockChangeParams, InventoryOverviewParams } from '@/types/inventory'

const KS = 'inventory-stock'
const KL = 'inventory-logs'
export const useStock = (p: QueryParams) => useQuery({ queryKey: [KS, p], queryFn: () => getStockApi(p) })
export const useLogs  = (p: QueryParams, enabled = true) => useVisibleQuery({ enabled, queryKey: [KL, p], queryFn: ({ signal }) => getLogsApi(p, signal) })

export function useInbound() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (d: StockChangeParams) => inboundApi(d), onSuccess: () => invalidate('inventory_change') })
}
export function useOutbound() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (d: StockChangeParams) => outboundApi(d), onSuccess: () => invalidate('inventory_change') })
}
export function useAdjust() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (d: Omit<StockChangeParams, 'supplierId' | 'unitPrice'>) => adjustApi(d), onSuccess: () => invalidate('inventory_change') })
}

const KO = 'inventory-overview'
export const useInventoryOverview = (p: InventoryOverviewParams, enabled = true) =>
  useVisibleQuery({ enabled, queryKey: [KO, p], queryFn: ({ signal }) => getInventoryOverviewApi(p, signal), placeholderData: prev => prev })

const KC = 'inventory-containers'
export const useInventoryContainers = (productId: number | null, warehouseId: number | null) =>
  useQuery({
    queryKey: [KC, productId, warehouseId],
    queryFn:  () => getInventoryContainersApi(productId!, warehouseId),
    enabled:  !!productId,
    staleTime: 10000,
  })
