import { useQuery } from '@tanstack/react-query'
import { payloadClient } from '@/api/client'

export interface AvgCostRow {
  rowKey: string
  productId: number
  productCode: string
  productName: string
  unit: string
  warehouseId: number
  unitCost: number
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
