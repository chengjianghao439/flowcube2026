import type { User } from '@/types'
import { hasPermission } from '@/lib/permissions'
import { isRegisteredErpRoute, resolveRoutePermission } from './routeDefinitions'
import { normalizeWorkspacePath } from './workspaceRouteMeta'

const DASHBOARD = '/dashboard'
const WORKBENCH = '/reports/role-workbench'

/** 登录来源也必须经过当前账号的路由权限，不能先跳入无权页面再由KeepAlive送到403。 */
export function resolveErpLoginDestination(user: Pick<User, 'roleId' | 'permissions'> | null | undefined, requestedPath?: unknown): string {
  const canOpen = (path: string) => {
    const permission = resolveRoutePermission(path)
    return isRegisteredErpRoute(path) && (!permission || hasPermission(user?.permissions, permission, user?.roleId))
  }
  if (!requestedPath) return canOpen(WORKBENCH) ? WORKBENCH : DASHBOARD
  if (typeof requestedPath !== 'string' || !requestedPath.startsWith('/') || requestedPath.startsWith('//') || requestedPath.includes('\\')) return DASHBOARD

  const pathname = requestedPath.split(/[?#]/)[0]
  const normalized = normalizeWorkspacePath(pathname)
  if (normalized === DASHBOARD || canOpen(normalized)) return normalized + requestedPath.slice(pathname.length)
  return DASHBOARD
}
