/**
 * ERP API 根地址（不含 /api）。保留已配置地址和原恢复记录使用的同源地址。
 */
import { IS_CAPACITOR_PDA, isElectronRuntime } from '@/lib/platform'
import { ERP_PRODUCTION_ORIGIN } from '@/config/env'

export const API_BASE_STORAGE_KEY = 'API_BASE_URL'

/** 旧版键名，读取时兼容；写入统一用 API_BASE_URL */
const LEGACY_ERP_ORIGIN_KEY = 'flowcube:apiOrigin'

type HealthPayload = {
  success?: boolean
  status?: string
  data?: {
    status?: string
  }
}

export function isHealthyApiPayload(payload: HealthPayload | null | undefined): boolean {
  return payload?.success === true && (payload.status === 'ok' || payload.data?.status === 'ok')
}

function readStorageValue(key: string): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(key)?.trim() || ''
}

function migrateLegacyApiBaseStorage(): string {
  if (typeof localStorage === 'undefined') return ''

  const current = normalizeApiBase(readStorageValue(API_BASE_STORAGE_KEY))
  if (current) {
    localStorage.removeItem(LEGACY_ERP_ORIGIN_KEY)
    return current
  }

  const legacy = normalizeApiBase(readStorageValue(LEGACY_ERP_ORIGIN_KEY))
  if (legacy) {
    localStorage.setItem(API_BASE_STORAGE_KEY, legacy)
  }
  localStorage.removeItem(LEGACY_ERP_ORIGIN_KEY)
  return legacy
}

function getStoredApiBaseOverride(): string {
  const migrated = migrateLegacyApiBaseStorage()
  if (migrated) return migrated
  const raw = readStorageValue(API_BASE_STORAGE_KEY)
  return raw ? normalizeApiBase(raw) : ''
}

function isFileProtocol(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'file:'
}

export function normalizeApiBase(raw: string): string {
  const t = raw.trim().replace(/\/$/, '')
  if (!t) return ''
  try {
    const u = new URL(t.startsWith('http') ? t : `http://${t}`)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

/**
 * 仅本机 localhost / 127.0.0.1 的 Vite :5173/:4173。
 * 在 Electron 安装包内无效（无本机 Vite）。局域网 IP 的 :5173（如 192.168.x.x）是访问 Mac 上 Vite 代理，应保留。
 */
export function isStaleLocalViteProxyOrigin(raw: string): boolean {
  const n = normalizeApiBase(raw)
  if (!n) return false
  try {
    const u = new URL(n)
    const p = u.port || (u.protocol === 'https:' ? '443' : '80')
    if (p !== '5173' && p !== '4173') return false
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1'
  } catch {
    return false
  }
}

/**
 * 安装包启动时清理本地残留地址：
 * - 已注入内置地址：桌面端只认内置地址，移除任何历史登录/探测固化的 override，
 *   否则老机器旧地址会压过新版内置地址，且已无快捷键可纠正。
 * - 内置地址缺失（漏注入）的应急态：仅清掉误同步的「本机」Vite 地址，保留 override 兜底。
 */
export function clearElectronStaleViteOrigins(): void {
  if (!isElectronRuntime()) return
  if (typeof localStorage === 'undefined') return
  const builtin = normalizeApiBase(getDynamicDefaultApi())
  const raw = readStorageValue(API_BASE_STORAGE_KEY)
  if (builtin) {
    if (raw) localStorage.removeItem(API_BASE_STORAGE_KEY)
  } else if (raw && isStaleLocalViteProxyOrigin(raw)) {
    localStorage.removeItem(API_BASE_STORAGE_KEY)
  }
  localStorage.removeItem(LEGACY_ERP_ORIGIN_KEY)
}

/**
 * Electron 使用安装包地址；本地文件也需要绝对 API 地址。
 * HTTP(S) 页面使用当前站点的 /api 代理，包含 Vite 预览和正式网页。
 */
export function getDynamicDefaultApi(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000'
  if (isFileProtocol() || isElectronRuntime()) return ERP_PRODUCTION_ORIGIN
  return window.location.origin === 'null' ? '' : window.location.origin
}

function hasSameOriginPackagedDefault(): boolean {
  return !IS_CAPACITOR_PDA && ERP_PRODUCTION_ORIGIN !== '' &&
    typeof window !== 'undefined' && ERP_PRODUCTION_ORIGIN === window.location.origin
}

export function probeErpApiOrigin(origin: string): Promise<boolean> {
  const o = normalizeApiBase(origin)
  if (!o) return Promise.resolve(false)
  return (async () => {
    try {
      const res = await fetch(`${o}/api/health`, { method: 'GET', cache: 'no-store' })
      if (!res.ok) return false
      const j = (await res.json()) as HealthPayload
      return isHealthyApiPayload(j)
    } catch {
      return false
    }
  })()
}

/** 当前站点同源 /api/health（浏览器 + Vite 代理等） */
export function probeRelativeErpApi(): Promise<boolean> {
  if (typeof window === 'undefined' || window.location.origin === 'null') return Promise.resolve(false)
  if (isFileProtocol()) return Promise.resolve(false)
  return (async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/health`, {
        method: 'GET',
        cache: 'no-store',
      })
      if (!res.ok) return false
      const j = (await res.json()) as HealthPayload
      return isHealthyApiPayload(j)
    } catch {
      return false
    }
  })()
}

/**
 * 仅允许当前明确配置的地址参与重试。
 * 网页的同源默认地址已由原请求使用，不是另一个重试候选。
 */
export function collectErpApiFallbackCandidates(): string[] {
  if (!isElectronRuntime() && !isFileProtocol() && hasSameOriginPackagedDefault()) return []
  const origin = getEffectiveApiOrigin()
  return origin ? [origin] : []
}

/** 已保存地址或动态默认（含旧键迁移） */
export function getApiBase(): string {
  return getEffectiveApiOrigin() ?? getDynamicDefaultApi()
}

/**
 * 用户是否曾在本机显式保存过后端根地址（设置 / 登录固化 / 旧版引导写入）。
 * 用于桌面端：避免启动探测或 axios 网络重试时「本机 localhost 先连通」覆盖用户真实服务器，导致空库与乱码感知的错配数据。
 */
export function hasUserConfiguredApiOrigin(): boolean {
  return Boolean(getStoredApiBaseOverride())
}

export function setApiBase(url: string): void {
  if (!url.trim()) {
    localStorage.removeItem(API_BASE_STORAGE_KEY)
    localStorage.removeItem(LEGACY_ERP_ORIGIN_KEY)
    return
  }
  const n = normalizeApiBase(url)
  if (n) {
    localStorage.setItem(API_BASE_STORAGE_KEY, n)
    localStorage.removeItem(LEGACY_ERP_ORIGIN_KEY)
  } else {
    localStorage.removeItem(API_BASE_STORAGE_KEY)
  }
}

/**
 * 保留同源旧地址的原始 Axios 形态，供恢复记录按原地址匹配。
 * 普通网页未配置地址时通过相对 /api 访问。
 */
export function getEffectiveApiOrigin(): string | null {
  if (isElectronRuntime() || isFileProtocol()) {
    if (ERP_PRODUCTION_ORIGIN) return ERP_PRODUCTION_ORIGIN
    const override = getStoredApiBaseOverride()
    return override && !isStaleLocalViteProxyOrigin(override) ? override : null
  }
  if (hasSameOriginPackagedDefault()) return ERP_PRODUCTION_ORIGIN
  return getStoredApiBaseOverride() || null
}

function publishDefaultApiOriginToWindow(): void {
  if (!isElectronRuntime()) return
  window.__FLOWCUBE_DEFAULT_API_ORIGIN__ = ERP_PRODUCTION_ORIGIN
}

publishDefaultApiOriginToWindow()

/** 登录后只维护已保存且实际使用的地址。 */
export function persistErpApiBaseAfterLogin(): void {
  if (isElectronRuntime() || isFileProtocol() || IS_CAPACITOR_PDA || hasSameOriginPackagedDefault()) return
  const saved = getStoredApiBaseOverride()
  if (saved) setApiBase(saved)
}
