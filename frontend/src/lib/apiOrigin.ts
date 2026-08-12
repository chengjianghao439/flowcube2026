/**
 * ERP / 桌面端：后端 HTTP 根地址；唯一 runtime override 存储键为 API_BASE_URL。
 * 旧键 flowcube:apiOrigin 仅在读取时自动迁移，不再作为独立配置源。
 */
import apiClient from '@/api/client'
import {
  getEffectiveApiOrigin,
  getApiBase,
  isHealthyApiPayload,
  normalizeApiBase,
  setApiBase,
} from '@/config/api'

export function normalizeApiOrigin(raw: string): string {
  return normalizeApiBase(raw)
}

export function getStoredApiOrigin(): string {
  return getEffectiveApiOrigin() ?? ''
}

export function setStoredApiOrigin(raw: string): void {
  setApiBase(raw)
}

/** 当前页面是否为 file://（Electron 加载本地 dist） */
export function isFileProtocol(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'file:'
}

/**
 * 根据本地配置同步 axios baseURL。
 * - 已配置或安装包内置默认：使用绝对 `${origin}/api`
 * - 浏览器未配置：相对 `/api`
 */
export function applyErpApiBaseFromStorage(): void {
  const origin = getEffectiveApiOrigin()
  if (!origin) {
    apiClient.defaults.baseURL = '/api'
    return
  }
  apiClient.defaults.baseURL = `${origin}/api`
}

/** 健康检查 URL（与 axios base 一致，供心跳等使用） */
export function getApiHealthUrl(): string {
  const base = (apiClient.defaults.baseURL || '/api').replace(/\/$/, '')
  if (base.startsWith('http')) return `${base}/health`
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return `${window.location.origin}${base}/health`
  }
  const o = getEffectiveApiOrigin() ?? getApiBase()
  return `${o}${base}/health`
}

/**
 * 始终返回「当前页面 origin 的 /api/health」（相对路径，走 Vite 代理 / 同源）。
 * 供 PDA dev（浏览器 Vite live）心跳使用：不依赖 apiClient.defaults.baseURL——
 * 一旦 baseURL 被 ERP fallback 之类改写成绝对地址，getApiHealthUrl 会探测到代理之外导致误报断网。
 */
export function getRelativeApiHealthUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return `${window.location.origin}/api/health`
  }
  return '/api/health'
}

/** 已配置 apiOrigin 时探测 /api/health（桌面端门控） */
export async function checkErpApiHealth(): Promise<boolean> {
  const url = getApiHealthUrl()
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' })
    if (!res.ok) return false
    const j = await res.json()
    return isHealthyApiPayload(j)
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
  const o = getEffectiveApiOrigin() ?? getApiBase()
  return `${o}${rel}`
}
