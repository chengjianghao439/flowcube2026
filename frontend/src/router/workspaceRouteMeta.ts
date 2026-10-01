import { ROUTE_ALIASES, resolveRouteTabIdentity, type RouteTabIdentity } from '@/router/routeDefinitions'
import { getMergedPageGroup } from './mergedPageGroups'

/**
 * 当页面主要上下文由 query 决定时，必须在这里登记。
 * 统一在路由元数据层定义 tab identity，避免页面各自手工决定是否用完整 URL 当 key。
 */
type WorkspaceRouteMeta = {
  tabIdentity?: RouteTabIdentity
}

export function normalizeWorkspacePath(path: string): string {
  const pathname = path.split(/[?#]/)[0] || '/'
  return ROUTE_ALIASES[pathname] ?? pathname
}

export function getWorkspaceFullPath(pathname: string, search: string): string {
  return `${normalizeWorkspacePath(pathname)}${search || ''}` || '/'
}

function getWorkspaceSearchParams(search: string): URLSearchParams {
  const raw = search.startsWith('?') ? search.slice(1) : search
  return new URLSearchParams(raw)
}

function buildCanonicalSearch(searchParams: URLSearchParams, keys?: string[], preserveEmptyKeys: readonly string[] = []): string {
  const pairs: Array<[string, string]> = []
  if (keys?.length) {
    for (const key of keys) {
      const values = searchParams.getAll(key).filter(value => value || preserveEmptyKeys.includes(key))
      values.sort()
      for (const value of values) pairs.push([key, value])
    }
  } else {
    for (const [key, value] of searchParams.entries()) {
      if (!value && !preserveEmptyKeys.includes(key)) continue
      pairs.push([key, value])
    }
    pairs.sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) return aValue.localeCompare(bValue)
      return aKey.localeCompare(bKey)
    })
  }
  if (!pairs.length) return ''
  return `?${new URLSearchParams(pairs).toString()}`
}

export function getWorkspaceRouteMeta(path: string): WorkspaceRouteMeta {
  const normalizedPath = normalizeWorkspacePath(path)
  const tabIdentity = resolveRouteTabIdentity(normalizedPath)
  return tabIdentity ? { tabIdentity } : {}
}

function resolveWorkspaceTabIdentity(pathname: string, search = ''): RouteTabIdentity {
  const explicit = getWorkspaceRouteMeta(pathname).tabIdentity
  if (explicit) return explicit
  return search ? { kind: 'full-url' } : { kind: 'pathname' }
}

export function buildCanonicalWorkspaceSearch(search = '', preserveEmptyKeys: readonly string[] = []): string {
  const searchParams = getWorkspaceSearchParams(search)
  return buildCanonicalSearch(searchParams, undefined, preserveEmptyKeys)
}

export function buildCanonicalWorkspacePath(pathname: string, search = ''): string {
  const normalizedPath = normalizeWorkspacePath(pathname)
  // 交接上下文的空值/重复值必须留给接收页拒绝，不能规范化成有效任务。
  const preserveEmptyKeys = normalizedPath === '/sorting-bins' ? ['taskId', 'warehouseId']
    : /^\/sale\/[1-9]\d*$/.test(normalizedPath) ? ['focus', 'taskId'] : []
  return `${normalizedPath}${buildCanonicalWorkspaceSearch(search, preserveEmptyKeys)}`
}

export function buildWorkspaceTabKey(pathname: string, search = ''): string {
  const normalizedPath = normalizeWorkspacePath(pathname)
  const group = getMergedPageGroup(normalizedPath)
  if (group) return group.key
  const rule = resolveWorkspaceTabIdentity(normalizedPath, search)
  if (rule.kind === 'pathname') return normalizedPath

  const searchParams = getWorkspaceSearchParams(search)
  const canonicalSearch = rule.kind === 'query-keys'
    ? buildCanonicalSearch(searchParams, rule.keys)
    : buildCanonicalSearch(searchParams)

  return `${normalizedPath}${canonicalSearch}`
}

export function buildWorkspaceTabRegistration(pathname: string, search = ''): { key: string; path: string } {
  const normalizedPath = normalizeWorkspacePath(pathname)
  return {
    key: buildWorkspaceTabKey(normalizedPath, search),
    path: buildCanonicalWorkspacePath(normalizedPath, search),
  }
}

export function buildWorkspaceTabRegistrationFromPath(path: string): { key: string; path: string } {
  const [pathname, rawSearch = ''] = path.split('?')
  return buildWorkspaceTabRegistration(pathname || '/', rawSearch ? `?${rawSearch}` : '')
}

export function isQuerySensitiveWorkspaceRoute(path: string): boolean {
  const pathname = path.split(/[?#]/)[0] || '/'
  return buildWorkspaceTabKey(pathname, path.includes('?') ? path.slice(path.indexOf('?')) : '') !== buildWorkspaceTabKey(pathname)
}
