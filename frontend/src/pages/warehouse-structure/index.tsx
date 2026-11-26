import { useContext } from 'react'
import { useLocation } from 'react-router-dom'
import { usePermission } from '@/hooks/usePermission'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { resolveRoutePermission, resolveRouteTitle } from '@/router/routeDefinitions'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PageViewNavigation } from '@/components/shared/PageViewNavigation'
import { PageHeaderContext } from '@/components/shared/PageHeaderContext'
import WarehousesPage from '@/pages/warehouses'
import LocationsPage from '@/pages/locations'
import RacksPage from '@/pages/racks'
import SortingBinsPage from '@/pages/sorting-bins'

const views = [
  { path: '/warehouses', Component: WarehousesPage },
  { path: '/locations', Component: LocationsPage },
  { path: '/racks', Component: RacksPage },
  { path: '/sorting-bins', Component: SortingBinsPage },
]

export default function WarehouseStructurePage() {
  const tabPath = useContext(TabPathContext)
  const location = useLocation()
  const { can } = usePermission()
  // 每个工作区标签保留自己的组件实例、查询条件和交接地址。
  const ownPath = tabPath || location.pathname + location.search
  const pathname = ownPath.split(/[?#]/)[0]
  const visibleViews = views.filter(({ path }) => {
    const permission = resolveRoutePermission(path)
    return permission && can(permission)
  })
  const activeView = visibleViews.find(view => view.path === pathname)
  if (!activeView) return null
  const { Component } = activeView

  const navigation = visibleViews.length > 1 && (
    <PageViewNavigation label="仓库结构视图" activePath={pathname}
      views={visibleViews.map(({ path }) => ({
        path,
        label: resolveRouteTitle(path)?.replace(/管理$/, '') ?? path,
        // 分拣格管理沿用普通入口，订单交接只从对应任务链接进入。
        to: path === '/sorting-bins' ? path : getWorkspaceListPath(path === pathname ? ownPath : path),
      }))} />
  )

  return <PageHeaderContext.Provider value={navigation ? { navigation } : null}>
    <Component />
  </PageHeaderContext.Provider>
}
