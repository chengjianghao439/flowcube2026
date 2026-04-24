import { ROUTE_ALIASES, resolveRouteTabIdentity, type RouteTabIdentity } from '@/router/routeRegistry'

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

function buildCanonicalSearch(searchParams: URLSearchParams, keys?: string[]): string {
  const pairs: Array<[string, string]> = []
  if (keys?.length) {
    for (const key of keys) {
      const values = searchParams.getAll(key).filter(Boolean)
      values.sort()
      for (const value of values) pairs.push([key, value])
    }
  } else {
    for (const [key, value] of searchParams.entries()) {
      if (!value) continue
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

export function buildCanonicalWorkspaceSearch(search = ''): string {
  const searchParams = getWorkspaceSearchParams(search)
  return buildCanonicalSearch(searchParams)
}

export function buildCanonicalWorkspacePath(pathname: string, search = ''): string {
  return `${normalizeWorkspacePath(pathname)}${buildCanonicalWorkspaceSearch(search)}`
}

export function buildWorkspaceTabKey(pathname: string, search = ''): string {
  const normalizedPath = normalizeWorkspacePath(pathname)
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
  return buildWorkspaceTabKey(path.split(/[?#]/)[0] || '/', path.includes('?') ? path.slice(path.indexOf('?')) : '') !== normalizeWorkspacePath(path)
}
