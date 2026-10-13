import { useCallback, useContext, useMemo, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useActiveWorkspaceTab } from './useActiveWorkspaceTab'

/** 已挂载列表读自身标签URL；没有标签上下文时沿用普通路由。 */
export function useWorkspacePath(): string {
  const tabPath = useContext(TabPathContext)
  const location = useLocation()
  return tabPath || location.pathname + location.search
}

export function useWorkspaceSearchParams(): ReturnType<typeof useSearchParams> {
  const tabPath = useContext(TabPathContext)
  const [locationParams, setLocationParams] = useSearchParams()
  const active = useActiveWorkspaceTab()
  const search = tabPath ? tabPath.split('?')[1] || '' : locationParams.toString()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const current = useRef({ tabPath, active, params })
  current.current = { tabPath, active, params }
  const setParams = useCallback<ReturnType<typeof useSearchParams>[1]>((next, options) => {
    const own = current.current
    if (own.tabPath && !own.active) return
    setLocationParams(typeof next === 'function' ? next(new URLSearchParams(own.params)) : next, options)
  }, [setLocationParams])
  return [params, setParams]
}
