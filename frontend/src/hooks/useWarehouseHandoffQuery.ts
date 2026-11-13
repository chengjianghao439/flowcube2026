import { useEffect } from 'react'
import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

/** Cross-device work can change while the same workspace remains open. */
export function useWarehouseHandoffQuery<T>(options: UseQueryOptions<T>, visible = true) {
  const enabled = visible && options.enabled !== false
  const query = useQuery({
    ...options,
    enabled,
    subscribed: enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  })
  const { refetch } = query
  useEffect(() => {
    if (!enabled) return
    // A separate foreground window can leave this document visible.
    const onFocus = () => { if (!document.hidden) void refetch({ cancelRefetch: false }) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, refetch])
  return query
}
