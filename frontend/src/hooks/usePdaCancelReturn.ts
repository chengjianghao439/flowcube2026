import { useQuery } from '@tanstack/react-query'
import { getPendingCancelReturnsApi, getCancelReturnDetailApi } from '@/api/warehouse-tasks'
import type { KitReadOwner } from '@/api/kits'
import { commercialReadConfig } from '@/api/sale-commercial'
import { assertKitReadOwner } from './useKits'

/** PDA 拣货退回 — 任务池列表（15s 轮询） */
export function usePdaPendingCancelReturns() {
  return useQuery({
    queryKey: ['pda-cancel-returns-pending'],
    queryFn: () => getPendingCancelReturnsApi().then(r => r ?? []),
    refetchInterval: 15_000,
  })
}

/** PDA 拣货退回 — 单笔退回任务详情 */
export function usePdaCancelReturnDetail(taskId: number, owner?: KitReadOwner) {
  return useQuery({
    queryKey: owner
      ? ['pda-cancel-return-detail', taskId, owner.baseURL, owner.userId, owner.sessionGeneration]
      : ['pda-cancel-return-detail', taskId],
    queryFn: async () => {
      if (!owner) return getCancelReturnDetailApi(taskId)
      assertKitReadOwner(owner)
      const data = await getCancelReturnDetailApi(taskId, commercialReadConfig(owner))
      assertKitReadOwner(owner)
      if (data.id !== taskId) throw new Error('原拣货退回任务身份不符')
      return data
    },
    enabled: taskId > 0,
  })
}
