import { useWorkspaceStore } from '@/store/workspaceStore'
import { routeRegistry } from '@/router/routeDefinitions'
import { buildWorkspaceTabRegistrationFromPath, mergeWorkspaceViewPaths, normalizeWorkspacePath } from '@/router/workspaceRouteMeta'

/** 返回/菜单沿用现有列表标签的原路径；显式查询、新建/详情身份与重置不改写。 */
export function getWorkspaceListPath(fallbackPath: string): string {
  if (/[?#]/.test(fallbackPath)) return fallbackPath
  const pathname = normalizeWorkspacePath(fallbackPath)
  if (!routeRegistry.some(route => route.path === pathname)) return fallbackPath
  const key = buildWorkspaceTabRegistrationFromPath(fallbackPath).key
  const tab = useWorkspaceStore.getState().tabs.find(item => item.key === key)
  if (!tab) return fallbackPath
  const saved = normalizeWorkspacePath(tab.path) === pathname ? tab.path
    : mergeWorkspaceViewPaths(tab.path, tab.viewPaths)?.[pathname]
  return saved && normalizeWorkspacePath(saved) === pathname && buildWorkspaceTabRegistrationFromPath(saved).key === key
    ? saved : fallbackPath
}
