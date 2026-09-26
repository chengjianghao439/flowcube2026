import { useVisibleQuery } from './useVisibleQuery'
import { useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getStockApi, getLogsApi, outboundApi, getInventoryOverviewApi, getInventoryContainersApi } from '@/api/inventory'
import { useInvalidate } from '@/hooks/useInvalidate'
import { createRequestKey } from '@/lib/requestKey'
import type { QueryParams } from '@/types'
import type { StockChangeParams, InventoryOverviewParams } from '@/types/inventory'

const KS = 'inventory-stock'
const KL = 'inventory-logs'
export const useStock = (p: QueryParams) => useQuery({ queryKey: [KS, p], queryFn: () => getStockApi(p) })
export const useLogs  = (p: QueryParams, enabled = true) => useVisibleQuery({ enabled, queryKey: [KL, p], queryFn: ({ signal }) => getLogsApi(p, signal) })

export function useOutbound() {
  const invalidate = useInvalidate()
  // 稳定幂等键：组件生命周期内复用同一 key，网络重试不重复扣减库存；
  // 成功后轮换供下一次出库（2026-09-26 一致性审查 · 任务 4）。
  const keyRef = useRef(createRequestKey('inventory-outbound'))
  return useMutation({
    mutationFn: (d: StockChangeParams) => outboundApi(d, keyRef.current),
    onSuccess: () => { invalidate('inventory_change'); keyRef.current = createRequestKey('inventory-outbound') },
  })
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
