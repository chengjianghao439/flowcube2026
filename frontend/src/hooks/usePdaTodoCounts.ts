import { useQuery } from '@tanstack/react-query'
import { getPdaTodoCountsApi } from '@/api/pda'

/** PDA 工作台「作业待办通知」计数（按设备绑定仓库聚合，30s 轮询） */
export function usePdaTodoCounts() {
  return useQuery({
    queryKey: ['pda-todo-counts'],
    queryFn: getPdaTodoCountsApi,
    refetchInterval: 30_000,
    // 未绑设备时接口返回 PDA_SESSION_REQUIRED，静默降级为无计数，不打断工作台
    retry: 1,
  })
}
