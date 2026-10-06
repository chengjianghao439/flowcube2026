import { ROUTE_ALIASES, resolveRoutePermission, resolveRouteTabIdentity, type RouteTabIdentity } from '@/router/routeDefinitions'
import type { PermissionRequirement } from '@/lib/permissions'
import { getMergedPageGroup } from './mergedPageGroups'

/** 仅保留本组合法子页路径；隐藏权限偏好不删除，不接受跨组或伪造的上下文。 */
export function mergeWorkspaceViewPaths(path: string, ...sources: unknown[]): Record<string, string> | undefined {
  const group = getMergedPageGroup(normalizeWorkspacePath(path))
  if (!group) return undefined
  const paths: Record<string, string> = {}
  for (const source of sources) {
    const entries = typeof source === 'string' ? [[normalizeWorkspacePath(source), source]]
      : source && typeof source === 'object' && !Array.isArray(source) ? Object.entries(source) : []
    for (const [key, value] of entries) {
      if (typeof value !== 'string' || !group.views.some(view => view.path === key) || normalizeWorkspacePath(value) !== key) continue
      paths[key] = buildWorkspaceTabRegistrationFromPath(value).path
    }
  }
  const current = buildWorkspaceTabRegistrationFromPath(path).path
  paths[normalizeWorkspacePath(current)] = current
  return paths
}

/** 菜单/常用入口复用已有合法子页，否则选择首个可见子页并沿用其原query。 */
export function resolveWorkspaceEntryPath(path: string, existing: { path: string; viewPaths?: Record<string, string> } | undefined, can: (permission: PermissionRequirement) => boolean): string {
  const permission = existing && resolveRoutePermission(normalizeWorkspacePath(existing.path))
  if (existing && permission && can(permission)) return existing.path
  const group = getMergedPageGroup(normalizeWorkspacePath(path))
  const first = group?.views.find(view => can(view.permission))
  if (!first) return path
  const paths = mergeWorkspaceViewPaths(existing?.path ?? path, existing?.viewPaths)
  return paths?.[first.path] ?? first.path
}

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

/** 匹配路径的单个冗余来源类型不拆草稿；错误、空值和重复类型仍交给接收页拒绝。 */
function normalizeReturnSourceType(pathname: string, searchParams: URLSearchParams) {
  if (searchParams.has('handlingSourceId')) return
  const kind = /^\/returns\/(sale|purchase)\/new$/.exec(pathname)?.[1]
  const types = searchParams.getAll('sourceType')
  if (kind && types.length === 1 && types[0] === kind && (searchParams.has('sourceId') || searchParams.has('sourceNo'))) searchParams.delete('sourceType')
}

/** 混用来源必须保持完整原身份，不能把空值/重复值清理成合法 handling 草稿。 */
function getHandlingSourceQueryKeys(pathname: string, searchParams: URLSearchParams): string[] | null {
  return searchParams.has('handlingSourceId') && ['/sale/new', '/returns/purchase/new', '/disposals/new'].includes(pathname)
    ? ['sourceId', 'sourceNo', 'sourceType', 'handlingSourceId'] : null
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
  const searchParams = getWorkspaceSearchParams(search)
  // 交接上下文的空值/重复值必须留给接收页拒绝，不能规范化成有效任务。
  const preserveEmptyKeys = getHandlingSourceQueryKeys(normalizedPath, searchParams) ?? (/^\/returns\/(sale|purchase)\/new$/.test(normalizedPath) ? ['sourceId', 'sourceNo', 'sourceType', 'handlingSourceId']
    : /^\/sale\/(new|new-kit)$/.test(normalizedPath) ? ['sourceId', 'handlingSourceId']
    : normalizedPath === '/supplier-refunds/new' ? ['purchaseReturnId']
    : normalizedPath === '/disposals/new' ? ['handlingSourceId', 'sourceId']
    : normalizedPath === '/sorting-bins' ? ['taskId', 'warehouseId']
    : /^\/sale\/[1-9]\d*$/.test(normalizedPath) ? ['focus', 'taskId']
      : ['/credit-overrides', '/price-change', '/disposals', '/finance/expenses', '/supplier-refunds'].includes(normalizedPath) ? ['detailId'] : [])
  normalizeReturnSourceType(normalizedPath, searchParams)
  return `${normalizedPath}${buildCanonicalSearch(searchParams, undefined, preserveEmptyKeys)}`
}

export function buildWorkspaceTabKey(pathname: string, search = ''): string {
  const normalizedPath = normalizeWorkspacePath(pathname)
  const group = getMergedPageGroup(normalizedPath)
  if (group) return group.key
  const rule = resolveWorkspaceTabIdentity(normalizedPath, search)
  if (rule.kind === 'pathname') return normalizedPath

  const searchParams = getWorkspaceSearchParams(search)
  const handlingKeys = getHandlingSourceQueryKeys(normalizedPath, searchParams)
  const preserveEmptyKeys = handlingKeys ?? (/^\/returns\/(sale|purchase)\/new$/.test(normalizedPath) ? ['sourceId', 'sourceNo', 'sourceType', 'handlingSourceId'] : /^\/sale\/(new|new-kit)$/.test(normalizedPath) ? ['sourceId', 'handlingSourceId'] : normalizedPath === '/supplier-refunds/new' ? ['purchaseReturnId']
    : normalizedPath === '/disposals/new' ? ['handlingSourceId', 'sourceId'] : [])
  normalizeReturnSourceType(normalizedPath, searchParams)
  const canonicalSearch = rule.kind === 'query-keys'
    ? buildCanonicalSearch(searchParams, handlingKeys ? [...new Set([...rule.keys, ...handlingKeys])] : rule.keys, preserveEmptyKeys)
    : buildCanonicalSearch(searchParams, undefined, preserveEmptyKeys)

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
