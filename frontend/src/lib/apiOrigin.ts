/**
 * ERP / 桌面端：后端 HTTP 根地址（localStorage），与 PDA 的 flowcube:pdaApiOrigin 分离。
 */
import apiClient from '@/api/client'

export const FLOWCUBE_API_ORIGIN_KEY = 'flowcube:apiOrigin'

/** 与 PDA normalize 一致：得到 protocol//host，不含路径、不含末尾 / */
export function normalizeApiOrigin(raw: string): string {
  const t = raw.trim().replace(/\/$/, '')
  if (!t) return ''
  try {
    const u = new URL(t.startsWith('http') ? t : `http://${t}`)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

export function getStoredApiOrigin(): string {
  const raw = localStorage.getItem(FLOWCUBE_API_ORIGIN_KEY)?.trim() ?? ''
  return raw ? normalizeApiOrigin(raw) : ''
}

export function setStoredApiOrigin(raw: string): void {
  const o = normalizeApiOrigin(raw)
  if (o) localStorage.setItem(FLOWCUBE_API_ORIGIN_KEY, raw.trim())
  else localStorage.removeItem(FLOWCUBE_API_ORIGIN_KEY)
}

/** 当前页面是否为 file://（Electron 加载本地 dist） */
export function isFileProtocol(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'file:'
}

/**
 * 根据 localStorage 同步 axios baseURL。
 * - 已配置 apiOrigin：始终使用 `${origin}/api`
 * - 未配置且非 file：保持默认 `/api`（Vite 代理 / 同源部署）
 * - 未配置且 file：保持 `/api`（无效，需在登录页填写服务器地址）
 */
export function applyErpApiBaseFromStorage(): void {
  const origin = getStoredApiOrigin()
  if (origin) {
    apiClient.defaults.baseURL = `${origin}/api`
    return
  }
  if (!isFileProtocol()) {
    apiClient.defaults.baseURL = '/api'
  }
}

/** 健康检查 URL（与 axios base 一致，供心跳等使用） */
export function getApiHealthUrl(): string {
  const base = (apiClient.defaults.baseURL || '/api').replace(/\/$/, '')
  if (base.startsWith('http')) return `${base}/health`
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return `${window.location.origin}${base}/health`
  }
  const o = getStoredApiOrigin()
  if (o) return `${o}${base}/health`
  return `${base}/health`
}

/** 已配置 apiOrigin 时探测 /api/health（桌面端门控） */
export async function checkErpApiHealth(): Promise<boolean> {
  const origin = getStoredApiOrigin()
  if (!origin) return true
  try {
    const res = await fetch(`${origin}/api/health`, { method: 'GET', cache: 'no-store' })
    if (!res.ok) return false
    const j = (await res.json()) as { success?: boolean; status?: string }
    return j?.success === true && j?.status === 'ok'
  } catch {
    return false
  }
}

/**
 * 将 /foo 形式的 API 路径转为 fetch 可用的绝对 URL（Electron file:// + 远程 API 时必需）
 */
export function resolveApiFetchUrl(path: string, query = ''): string {
  const base = (apiClient.defaults.baseURL || '/api').replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  const rel = `${base}${p}${query}`
  if (rel.startsWith('http')) return rel
  if (typeof window !== 'undefined') {
    const og = window.location.origin
    if (og && og !== 'null') return `${og}${rel}`
  }
  const o = getStoredApiOrigin()
  if (o) return `${o}${rel}`
  return rel
}
