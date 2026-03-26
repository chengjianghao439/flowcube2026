/**
 * ERP API 根地址（不含 /api）。支持按 hostname 动态默认、多地址探测与 fallback。
 */
export const API_BASE_STORAGE_KEY = 'API_BASE_URL'

/** 旧版键名，读取时兼容；写入统一用 API_BASE_URL */
const LEGACY_ERP_ORIGIN_KEY = 'flowcube:apiOrigin'

/** 公网/生产默认（可通过 VITE_ERP_PRODUCTION_ORIGIN 覆盖） */
export const PRODUCTION_ERP_FALLBACK = 'https://erp.xxx.com'

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
 * 按当前页面 hostname 推断默认 API 根：
 * - Electron / file://：页面无 hostname，优先 VITE_ERP_PRODUCTION_ORIGIN（打包时注入），否则 localhost:3000
 * - Vite dev(5173) / preview(4173)：统一用当前页面 origin，API 走 /api 代理（局域网用 Mac IP 打开时勿直连 :3000，否则连到访问者本机或未监听端口）
 * - 浏览器 localhost / 127.0.0.1 → http://localhost:3000（直连后端，本机开发）
 * - 浏览器 192.168.* 且非上述端口 → http://{同主机}:3000
 * - 其它 → 生产域名（env 或 https://erp.xxx.com）
 */
export function getDynamicDefaultApi(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000'
  const envProdRaw = import.meta.env.VITE_ERP_PRODUCTION_ORIGIN?.trim()
  const envProd = envProdRaw ? normalizeApiBase(envProdRaw) : ''
  const prodFallback =
    normalizeApiBase(envProdRaw || PRODUCTION_ERP_FALLBACK) || PRODUCTION_ERP_FALLBACK

  const isElectronBundle = import.meta.env.VITE_ELECTRON === '1'
  if (isFileProtocol() || isElectronBundle) {
    if (envProd) return envProd
    return 'http://localhost:3000'
  }

  const port = window.location.port
  if (port === '5173' || port === '4173') {
    return window.location.origin.replace(/\/$/, '')
  }

  const h = window.location.hostname.toLowerCase()
  if (!h || h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3000'
  if (/^192\.168\./.test(h)) return `http://${h}:3000`
  return prodFallback
}

export function probeErpApiOrigin(origin: string): Promise<boolean> {
  const o = normalizeApiBase(origin)
  if (!o) return Promise.resolve(false)
  return (async () => {
    try {
      const res = await fetch(`${o}/api/health`, { method: 'GET', cache: 'no-store' })
      if (!res.ok) return false
      const j = (await res.json()) as { success?: boolean; status?: string }
      return j?.success === true && j?.status === 'ok'
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
      const j = (await res.json()) as { success?: boolean; status?: string }
      return j?.success === true && j?.status === 'ok'
    } catch {
      return false
    }
  })()
}

/**
 * fallback 尝试顺序（去重）：
 * localStorage → 动态默认 → localhost:3000 → 生产域名
 */
export function collectErpApiFallbackCandidates(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string | null | undefined) => {
    const n = raw ? normalizeApiBase(raw) : ''
    if (n && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }

  add(typeof localStorage !== 'undefined' ? localStorage.getItem(API_BASE_STORAGE_KEY) : null)
  add(typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_ERP_ORIGIN_KEY) : null)

  if (typeof window !== 'undefined') {
    add(getDynamicDefaultApi())
    add('http://localhost:3000')
    const envProd = import.meta.env.VITE_ERP_PRODUCTION_ORIGIN?.trim()
    add(normalizeApiBase(envProd || PRODUCTION_ERP_FALLBACK))
  } else {
    add('http://localhost:3000')
    add(PRODUCTION_ERP_FALLBACK)
  }

  return out
}

/** 已保存地址或动态默认（含旧键迁移） */
export function getApiBase(): string {
  const v = localStorage.getItem(API_BASE_STORAGE_KEY)?.trim()
  if (v) {
    const n = normalizeApiBase(v)
    return n || getDynamicDefaultApi()
  }
  const leg = localStorage.getItem(LEGACY_ERP_ORIGIN_KEY)?.trim()
  if (leg) {
    const n = normalizeApiBase(leg)
    if (n) return n
  }
  return getDynamicDefaultApi()
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
 * axios：浏览器未手动配置时返回 null → 相对路径 /api；
 * file:// 或未配置时用动态默认（保证 Electron 等可连）。
 */
export function getEffectiveApiOrigin(): string | null {
  const v = localStorage.getItem(API_BASE_STORAGE_KEY)?.trim()
  if (v) {
    const n = normalizeApiBase(v)
    return n || null
  }
  const leg = localStorage.getItem(LEGACY_ERP_ORIGIN_KEY)?.trim()
  if (leg) {
    const n = normalizeApiBase(leg)
    if (n) return n
  }
  if (!isFileProtocol()) return null
  const d = normalizeApiBase(getDynamicDefaultApi())
  return d || null
}

/** 登录成功后固化当前 API 根 */
export function persistErpApiBaseAfterLogin(): void {
  const existing = getEffectiveApiOrigin()
  if (existing) {
    setApiBase(existing)
    return
  }
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    setApiBase(window.location.origin)
  }
}
