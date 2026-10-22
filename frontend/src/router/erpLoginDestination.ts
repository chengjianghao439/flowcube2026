import type { User } from '@/types'
import { hasPermission } from '@/lib/permissions'
import { isRegisteredErpRoute, resolveRoutePermission, routeRegistry } from './routeDefinitions'
import { normalizeWorkspacePath } from './workspaceRouteMeta'

const WORKBENCH = '/reports/role-workbench'
export const ERP_NO_ACCESS_PATH = '/no-access'

// 待办优先，其余沿现有注册顺序（仪表盘起）；对外查询放在ERP业务页面之后。
const defaultPaths = [
  WORKBENCH,
  ...routeRegistry.filter(route => !route.path.startsWith('/portal/')).map(route => route.path),
  ...routeRegistry.filter(route => route.path.startsWith('/portal/')).map(route => route.path),
]

/** 登录来源也必须经过当前账号的路由权限，不能先跳入无权页面再由KeepAlive送到403。 */
export function resolveErpLoginDestination(user: Pick<User, 'roleId' | 'permissions'> | null | undefined, requestedPath?: unknown): string {
  const canOpen = (path: string) => {
    const permission = resolveRoutePermission(path)
    return isRegisteredErpRoute(path) && (!permission || hasPermission(user?.permissions, permission, user?.roleId))
  }
  if (typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//') && !requestedPath.includes('\\')) {
    const pathname = requestedPath.split(/[?#]/)[0]
    const normalized = normalizeWorkspacePath(pathname)
    if (canOpen(normalized)) return normalized + requestedPath.slice(pathname.length)
  }
  return defaultPaths.find(canOpen) ?? ERP_NO_ACCESS_PATH
}
