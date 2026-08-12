import { useQuery } from '@tanstack/react-query'
import { getPendingAdjustmentsApi, getAdjustmentDetailApi } from '@/api/warehouse-tasks'

/** PDA 改单确认 — 任务池列表（15s 轮询） */
export function usePdaPendingAdjustments() {
  return useQuery({
    queryKey: ['pda-adjustments-pending'],
    queryFn: () => getPendingAdjustmentsApi().then(r => r ?? []),
    refetchInterval: 15_000,
  })
}

/** PDA 改单确认 — 单笔改单详情 */
export function usePdaAdjustmentDetail(adjustmentId: number) {
  return useQuery({
    queryKey: ['pda-adjustment-detail', adjustmentId],
    queryFn: () => getAdjustmentDetailApi(adjustmentId),
    enabled: adjustmentId > 0,
  })
}
