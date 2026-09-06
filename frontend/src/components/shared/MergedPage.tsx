import { lazy, Suspense, useContext, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PageHeaderContext } from './PageHeaderContext'
import { getMergedPageGroup, type MergedPageGroup } from '@/router/mergedPageGroups'
import { usePermission } from '@/hooks/usePermission'

// 每个视图独立分包；进入一个中心不会加载其余图表或触发其查询。
const views: Record<string, LazyExoticComponent<ComponentType>> = {
  '/procurement': lazy(() => import('@/pages/procurement')),
  '/reports/replenishment': lazy(() => import('@/pages/reports/replenishment')),
  '/reports': lazy(() => import('@/pages/reports')),
  '/reports/kpi': lazy(() => import('@/pages/reports/kpi')),
  '/reports/profit-analysis': lazy(() => import('@/pages/reports/profit-analysis')),
  '/reports/warehouse-ops': lazy(() => import('@/pages/reports/warehouse-ops')),
  '/reports/wave-performance': lazy(() => import('@/pages/reports/wave-performance')),
  '/reports/pda-anomaly': lazy(() => import('@/pages/reports/pda-anomaly')),
}

function MergedPageViews({ group, ownPath }: { group: MergedPageGroup; ownPath: string }) {
  const { can } = usePermission()
  const pathname = ownPath.split(/[?#]/)[0]
  const [visited, setVisited] = useState<Record<string, string>>({})
  const visibleViews = group.views.filter(view => can(view.permission))
  const allowed = visibleViews.some(view => view.path === pathname)

  useEffect(() => {
    if (!allowed) return
    setVisited(previous => previous[pathname] === ownPath ? previous : { ...previous, [pathname]: ownPath })
  }, [pathname, ownPath, allowed])

  if (!allowed) return <p className="py-12 text-center text-muted-foreground">无访问权限</p>

  const paths = { ...visited, [pathname]: ownPath }
  const navigation = (
    <nav aria-label={`${group.title}视图`} className="mb-4 flex flex-wrap gap-x-5 gap-y-1 border-b border-border">
      {visibleViews.map(view => (
        <Link
          key={view.path}
          to={paths[view.path] ?? view.path}
          aria-current={pathname === view.path ? 'page' : undefined}
          className={`border-b-2 px-1 py-2 text-sm font-medium transition-colors ${pathname === view.path ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >{view.label}</Link>
      ))}
    </nav>
  )

  return <>
    {visibleViews.filter(view => paths[view.path]).map(view => {
      const Component = views[view.path]
      return (
        <div key={view.path} hidden={pathname !== view.path}>
          <TabPathContext.Provider value={paths[view.path]}>
            <PageHeaderContext.Provider value={{ title: group.title, navigation }}>
              <Suspense fallback={<p className="py-12 text-center text-muted-foreground">正在加载{view.label}…</p>}>
                <Component />
              </Suspense>
            </PageHeaderContext.Provider>
          </TabPathContext.Provider>
        </div>
      )
    })}
  </>
}

export default function MergedPage() {
  const tabPath = useContext(TabPathContext)
  const location = useLocation()
  const ownPath = tabPath || location.pathname + location.search
  const group = getMergedPageGroup(ownPath)
  if (!group) return null
  return <MergedPageViews key={group.key} group={group} ownPath={ownPath} />
}
