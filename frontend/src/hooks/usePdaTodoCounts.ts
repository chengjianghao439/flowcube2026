import { useQuery } from '@tanstack/react-query'
import { getPdaTodoCountsApi } from '@/api/pda'

/**
 * PDA 工作台「作业待办通知」计数（按设备绑定仓库聚合，30s 轮询）。
 * 2026-08-22 优化：页面切后台（document.hidden，PDA 全屏 app 被切走）时暂停轮询，
 * 回来自动恢复——避免后台空转消耗电量/流量。
 */
export function usePdaTodoCounts() {
  const visible = typeof document === 'undefined' || !document.hidden
  return useQuery({
    queryKey: ['pda-todo-counts'],
    queryFn: getPdaTodoCountsApi,
    refetchInterval: visible ? 30_000 : false,
    // 未绑设备时接口返回 PDA_SESSION_REQUIRED，静默降级为无计数，不打断工作台
    retry: 1,
  })
}
