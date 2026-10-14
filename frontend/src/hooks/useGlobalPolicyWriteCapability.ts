import { useEffect, useRef } from 'react'
import apiClient from '@/api/client'
import { getGlobalPolicyWriteCapabilityApi } from '@/api/auth'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { useVisibleQuery } from './useVisibleQuery'

/** Scope capability supplements the caller's original management permission. */
export function useGlobalPolicyWriteCapability(enabled = true) {
  const visible = useSectionActive() && enabled
  const userId = useAuthStore(s => s.user?.id ?? null)
  const sessionGeneration = useAuthStore(s => s.sessionGeneration)
  const hasSession = useAuthStore(s => !!s.token)
  const baseURL = apiClient.defaults.baseURL ?? '/api'
  const current = useRef(visible), mounted = useRef(true), allowedRef = useRef(false)
  current.current = visible
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  function ownsRead() {
    const auth = useAuthStore.getState()
    return mounted.current && current.current && !!auth.token && auth.user?.id === userId
      && auth.sessionGeneration === sessionGeneration && (apiClient.defaults.baseURL ?? '/api') === baseURL
  }
  const query = useVisibleQuery({
    queryKey: ['global-policy-write-capability', baseURL, userId, sessionGeneration, visible],
    enabled: visible && hasSession && userId != null,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    queryFn: async ({ signal }) => {
      if (!ownsRead()) throw Error('当前权限读取已暂停')
      const allowed = await getGlobalPolicyWriteCapabilityApi({
        baseURL, signal, _erpApiFallbackTried: true,
        _authSessionGeneration: sessionGeneration, skipGlobalError: true,
      })
      if (!ownsRead()) throw Error('权限读取来源已变化')
      return allowed
    },
  })
  const allowed = visible && hasSession && query.isSuccess && !query.isError && !query.isFetching
    && query.isFetchedAfterMount && query.data === true && ownsRead()
  allowedRef.current = allowed
  return {
    allowed,
    // Recheck the current owner at the click too, including a changed server.
    isAllowed: () => allowedRef.current && ownsRead(),
    isLoading: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}
