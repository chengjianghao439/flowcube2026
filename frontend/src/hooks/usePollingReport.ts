/**
 * usePollingReport — 轮询报表 hook
 *
 * 封装报表看板页（warehouse-ops / wave-performance / pda-anomaly）重复的
 * 「激活时才轮询」模式：useActiveWorkspaceTab + refetchInterval。
 * 顺带返回 dataUpdatedAt / refetch，供「上次刷新时间 + 立即刷新」展示。
 */
import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'

export function usePollingReport<TData, TError = unknown>({
  queryKey,
  queryFn,
  intervalMs = 60_000,
  stopOnForbidden = false,
  ...rest
}: {
  queryKey: QueryKey
  queryFn: () => Promise<TData>
  intervalMs?: number
  stopOnForbidden?: boolean
} & Omit<UseQueryOptions<TData, TError>, 'queryKey' | 'queryFn' | 'refetchInterval' | 'enabled'>) {
  const isActiveTab = useActiveWorkspaceTab()
  const query = useQuery<TData, TError>({
    queryKey,
    queryFn,
    enabled: isActiveTab,
    refetchInterval: q => isActiveTab && !(stopOnForbidden && (q.state.error as { status?: number } | null)?.status === 403) ? intervalMs : false,
    ...rest,
  })
  return {
    ...query,
    isActiveTab,
    /** 上次成功刷新时间（Date），供「上次刷新」展示 */
    updatedAtLabel: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : undefined,
  }
}
