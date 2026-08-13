import { useQuery } from '@tanstack/react-query'
import { getPendingCancelReturnsApi, getCancelReturnDetailApi } from '@/api/warehouse-tasks'

/** PDA 拣货退回 — 任务池列表（15s 轮询） */
export function usePdaPendingCancelReturns() {
  return useQuery({
    queryKey: ['pda-cancel-returns-pending'],
    queryFn: () => getPendingCancelReturnsApi().then(r => r ?? []),
    refetchInterval: 15_000,
  })
}

/** PDA 拣货退回 — 单笔退回任务详情 */
export function usePdaCancelReturnDetail(taskId: number) {
  return useQuery({
    queryKey: ['pda-cancel-return-detail', taskId],
    queryFn: () => getCancelReturnDetailApi(taskId),
    enabled: taskId > 0,
  })
}
