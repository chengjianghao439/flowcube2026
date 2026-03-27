/**
 * 与 desktop/lib/updateCheck.js 中 resolveDownloadUrl 一致，用于渲染层拼安装包地址。
 */
function isGitHubReleaseOrCdnUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString)
    if (u.hostname === 'github.com' && u.pathname.includes('/releases/download/')) return true
    if (u.hostname.endsWith('githubusercontent.com')) return true
    return false
  } catch {
    return false
  }
}

export function isValidDownloadUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (!u.hostname) return false
    return true
  } catch {
    return false
  }
}

export function resolveAppUpdateDownloadUrl(
  payload: { url?: string | null; filename?: string | null },
  origin: string,
): string {
  const base = String(origin || '').replace(/\/$/, '')
  let url = typeof payload.url === 'string' ? payload.url.trim() : ''
  const fn = typeof payload.filename === 'string' ? payload.filename.trim() : ''
  if (isValidDownloadUrl(url) && isGitHubReleaseOrCdnUrl(url) && fn && base) {
    const sameOrigin = `${base}/downloads/${encodeURIComponent(fn)}`
    if (isValidDownloadUrl(sameOrigin)) return sameOrigin
  }
  if (isValidDownloadUrl(url)) return url
  if (url.startsWith('/')) {
    const built = `${base}${url}`
    if (isValidDownloadUrl(built)) return built
  }
  if (fn && base) {
    const built = `${base}/downloads/${encodeURIComponent(fn)}`
    if (isValidDownloadUrl(built)) return built
  }
  return ''
}
