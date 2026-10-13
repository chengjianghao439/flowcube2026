import { useQuery } from '@tanstack/react-query'
import { payloadClient } from '@/api/client'

export interface AvgCostRow {
  rowKey: string
  productId: number
  productCode: string
  productName: string
  unit: string
  articleNumber: string | null
  spec: string | null
  color: string | null
  warehouseId: number
  unitCost: number
  unitCostSource?: 'avg_cost' | 'cost_price' | 'zero_fallback'
  cacheQty: number
  containerQty: number
  diffQty: number
  cacheValue: number
  containerValue: number
  diffValue: number
  drifted: boolean
}
export interface AvgCostResult {
  ok: boolean
  driftedCount: number
  totalDiffValue: number
  totalRows: number
  list: AvgCostRow[]
  truncated?: boolean
  matchedRows?: number
}

export function getAvgCostReconciliationApi() {
  return payloadClient.get<AvgCostResult>('/reports/avg-cost-reconciliation')
}

export function useAvgCostReconciliation() {
  return useQuery({
    queryKey: ['avg-cost-reconciliation'],
    queryFn: () => getAvgCostReconciliationApi().then(r => r ?? null),
  })
}
