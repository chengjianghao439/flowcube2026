import { useContext } from 'react'
import { useLocation } from 'react-router-dom'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { buildWorkspaceTabRegistration, buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { getMergedPageGroup } from '@/router/mergedPageGroups'

export function useActiveWorkspaceTab(): boolean {
  const tabPath = useContext(TabPathContext)
  const location = useLocation()
  const currentKey = buildWorkspaceTabRegistration(location.pathname, location.search).key
  const tabKey = tabPath
    ? buildWorkspaceTabRegistrationFromPath(tabPath).key
    : currentKey
  const ownPathname = tabPath?.split(/[?#]/)[0]
  // 合并组共用工作区 key，但隐藏的组内视图不能继续轮询。
  const isCurrentView = !ownPathname || !getMergedPageGroup(ownPathname) || ownPathname === location.pathname
  return currentKey === tabKey && isCurrentView
}
