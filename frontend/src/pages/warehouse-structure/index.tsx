import { useContext } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { usePermission } from '@/hooks/usePermission'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { resolveRoutePermission, resolveRouteTitle } from '@/router/routeDefinitions'
import { TabPathContext } from '@/components/layout/TabPathContext'
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
    <nav aria-label="仓库结构视图" className="mb-4 flex flex-wrap gap-x-5 gap-y-1 border-b border-border">
      {visibleViews.map(({ path }) => {
        const current = path === pathname
        // 分拣格管理沿用普通入口，订单交接只从订单的任务链接进入。
        const destination = path === '/sorting-bins' ? path : getWorkspaceListPath(current ? ownPath : path)
        return <Link key={path} to={destination} aria-current={current ? 'page' : undefined}
          className={`border-b-2 px-2.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${current ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-transparent font-medium text-muted-foreground hover:text-foreground'}`}
        >{resolveRouteTitle(path)}</Link>
      })}
    </nav>
  )

  return <PageHeaderContext.Provider value={navigation ? { title: '仓库结构', navigation } : null}>
    <Component />
  </PageHeaderContext.Provider>
}
