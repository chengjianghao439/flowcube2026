export interface HashRouterWindowLocation {
  pathname: string
  search: string
  fullPath: string
}

export function getHashRouterWindowLocation(source: Pick<Location, 'hash'> = window.location): HashRouterWindowLocation {
  const rawHash = typeof source.hash === 'string' ? source.hash : ''
  const hashPath = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  const normalized = hashPath.startsWith('/') ? hashPath : '/'
  const [pathnamePart, searchPart = ''] = normalized.split('?')
  const pathname = pathnamePart || '/'
  const search = searchPart ? `?${searchPart}` : ''
  return {
    pathname,
    search,
    fullPath: `${pathname}${search}`,
  }
}
