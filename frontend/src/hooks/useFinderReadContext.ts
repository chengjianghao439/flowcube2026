import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { hasPermission, type PermCode } from '@/lib/permissions'
import type { ProductFinderReadContext } from './useProducts'

const identity = () => {
  const auth = useAuthStore.getState()
  return JSON.stringify([getApiClientBaseURL(), !!auth.token, auth.sessionGeneration, auth.user?.id, auth.user?.roleId, auth.user?.permissions])
}
let previous = identity(), epoch = 0, nextRead = 0
const listeners = new Set<() => void>()
function changed() {
  const value = identity()
  if (value === previous) return
  previous = value; epoch++
  listeners.forEach(listener => listener())
}
subscribeApiClientBaseURL(changed)
useAuthStore.subscribe(changed)
const noSubscription = () => () => {}
const zero = () => 0

/** Explicit procurement picker reads; legacy and sale callers retain their existing ownership. */
export function useFinderReadContext(enabled: boolean, open: boolean, permission: PermCode, scope: string): (ProductFinderReadContext & { cancel: () => void }) | undefined {
  const cache = useContext(QueryClientContext), active = useSectionActive()
  const lifecycleRef = useRef<{ id: string; controller: AbortController; mounted: boolean } | null>(null)
  const subscribe = useCallback((listener: () => void) => {
    const onChange = () => {
      const lifecycle = lifecycleRef.current
      lifecycle?.controller.abort()
      if (lifecycle) void cache?.cancelQueries({ predicate: query => query.queryKey.includes(lifecycle.id) })
      listener()
    }
    listeners.add(onChange)
    return () => { listeners.delete(onChange) }
  }, [cache])
  const currentEpoch = useSyncExternalStore(enabled ? subscribe : noSubscription, enabled ? () => epoch : zero)
  // A changed source cannot silently become the owner of an already-open picker, including A→B→A.
  const owner = useMemo(() => enabled && open ? {
    epoch, baseURL: getApiClientBaseURL(), generation: useAuthStore.getState().sessionGeneration,
  } : null, [enabled, open])
  const lifecycle = useMemo(() => ({ id: `purchase-finder-read-${++nextRead}`, controller: new AbortController(), mounted: true, owner, active, epoch: currentEpoch }), [owner, active, currentEpoch])
  lifecycleRef.current = lifecycle
  useLayoutEffect(() => {
    // StrictMode replays effect cleanup/setup; reopen this controller before query subscriptions run.
    if (lifecycle.controller.signal.aborted) lifecycle.controller = new AbortController()
    lifecycle.mounted = true
    return () => {
      lifecycle.mounted = false
      lifecycle.controller.abort()
      if (enabled) void cache?.cancelQueries({ predicate: query => query.queryKey.includes(lifecycle.id) })
    }
  }, [cache, enabled, lifecycle])
  const latest = useRef({ open, active, permission })
  latest.current = { open, active, permission }
  const current = () => {
    const auth = useAuthStore.getState()
    return !!lifecycle.owner && latest.current.open && latest.current.active && lifecycle.active
      && lifecycle.owner.epoch === epoch && lifecycle.epoch === epoch
      && lifecycle.mounted && !lifecycle.controller.signal.aborted && hasPermission(auth.user?.permissions, latest.current.permission, auth.user?.roleId)
  }
  if (!enabled) return undefined
  return {
    key: ['purchase-finder', scope, lifecycle.id], enabled: current(),
    config: { baseURL: owner?.baseURL, _authSessionGeneration: owner?.generation, _erpApiFallbackTried: true, automaticReplay: false, skipGlobalError: true },
    assertCurrent: () => { if (!current()) throw new Error('读取已暂停，输入已保留，请关闭后重新选择') },
    cancel: () => {
      lifecycle.controller.abort()
      void cache?.cancelQueries({ predicate: query => query.queryKey.includes(lifecycle.id) })
    },
  }
}
