import type { RoleWorkbenchData } from '@/api/reports'
import type { PermCode } from './permissions'
import { isRegisteredErpRoute, resolveRoutePermission } from '@/router/routeDefinitions'
import { normalizeWorkspacePath } from '@/router/workspaceRouteMeta'

type Can = (permission: PermCode) => boolean
// 兼容旧服务/缓存：已取消的巡检与收货审核不能重新出现。
const retired = new Set(['sale-anomaly', 'management-anomaly-task', 'management-stock', 'management-high-risk', 'warehouse-audit', 'management-audit'])

export function canOpenWorkbenchPath(path: string, can: Can): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false
  const pathname = normalizeWorkspacePath(path)
  if (pathname === '/reports/role-workbench' || !isRegisteredErpRoute(pathname)) return false
  const permission = resolveRoutePermission(pathname)
  return !permission || can(permission)
}

/** 首页与完整中心共享过滤口径；不会改写 React Query 内的原始数据。 */
export function visibleWorkbench(data: RoleWorkbenchData, can: Can): RoleWorkbenchData {
  const sections = data.sections.map(section => ({
    ...section,
    cards: section.cards.filter(card => !retired.has(card.key) && canOpenWorkbenchPath(card.path, can)).map(card => {
      const items = card.items.filter(item => canOpenWorkbenchPath(item.path, can))
      return { ...card, items, count: items.length === card.items.length ? card.count : items.length }
    }),
  })).filter(section => section.cards.length > 0)
  const count = (key: string) => sections.filter(s => s.key === key).reduce((sum, s) => sum + s.cards.reduce((n, c) => n + c.count, 0), 0)
  return {
    ...data, sections,
    summary: { totalAlerts: sections.reduce((sum, s) => sum + s.cards.reduce((n, c) => n + c.count, 0), 0), warehouseCount: count('warehouse'), saleCount: count('sale'), managementCount: count('management') },
    topAlert: data.topAlert && sections.some(s => s.cards.some(c => c.path === data.topAlert!.path && c.title === data.topAlert!.title)) ? data.topAlert : null,
  }
}
