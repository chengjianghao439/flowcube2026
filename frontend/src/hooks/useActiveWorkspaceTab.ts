import { useContext } from 'react'
import { useLocation } from 'react-router-dom'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { buildWorkspaceTabRegistration, buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'

export function useActiveWorkspaceTab(): boolean {
  const tabPath = useContext(TabPathContext)
  const location = useLocation()
  const currentKey = buildWorkspaceTabRegistration(location.pathname, location.search).key
  const tabKey = tabPath
    ? buildWorkspaceTabRegistrationFromPath(tabPath).key
    : currentKey
  return currentKey === tabKey
}
