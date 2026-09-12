import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'

/** 隐藏页解除查询订阅；最后一个观察者离开时 Query 自动取消读取，不影响其他可见消费者。 */
export function useVisibleQuery<T>(options: UseQueryOptions<T>) {
  const active = useSectionActive()
  return useQuery({ ...options, enabled: active ? options.enabled : false, subscribed: active && options.enabled !== false })
}
