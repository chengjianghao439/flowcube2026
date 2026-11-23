/**
 * PDA 设备绑定与设备会话票据
 *
 * 绑定：ERP 里登记设备拿到「设备码 + 密钥」，PDA 扫二维码把这对凭据存在本机。
 * 这对凭据是长期的，跟着机器走，换人登录不影响。
 *
 * 票据：每次登录后用凭据换一张设备会话票据（默认 7 天 + 心跳续期），之后所有请求都带上它。
 * 服务端据此知道「这台机器是谁、属于哪个仓」，绑了仓库的设备扫别仓单据会被直接拒。
 *
 * 存储（2026-08-21 权衡修复）：原生 APK 用 SecureStorage 插件（Android Keystore
 * AES-GCM 加密存 SharedPreferences），明文不再落盘；非原生（浏览器 dev）回退
 * 内存态（不持久化）。axios 请求拦截器必须同步读票据，因此维护内存缓存：
 * 启动时 initDeviceBinding() 从加密存储水合，此后 getter 同步读内存。
 */

import { secureStorage } from '@/lib/secureStorage'

const CREDENTIAL_KEY = 'flowcube-pda-device'
const SESSION_KEY = 'flowcube-pda-session'

interface PdaDeviceCredential {
  deviceCode: string
  deviceSecret: string
  boundAt: string
}

export interface PdaDeviceSession {
  token: string
  warehouseId: number | null
  /** 绑定仓名称（2026-09-17 起随会话返回）；旧缓存会话可能为 undefined，展示时回退 #id */
  warehouseName?: string | null
  expiresAt: string | null
  scopes: string[]
}

// ── 内存缓存（同步 getter 的数据源）──────────────────────────────────────
let bindingGeneration = 0
let sessionRevision = 0
let persistence = Promise.resolve()
let cachedCredential: PdaDeviceCredential | null = null
let cachedSession: PdaDeviceSession | null = null
let hydrated = false
let hydrationFailed = false
let hydrationPromise: Promise<boolean> | null = null

export function getDeviceBindingGeneration(): number {
  return bindingGeneration
}

export function getDeviceSessionRevision(): number {
  return sessionRevision
}

function persistChange(action: () => Promise<void>): Promise<void> {
  // 原生桥接写按调用顺序完成，较旧的异步操作不会回写掉较新的绑定。
  persistence = persistence.then(action).catch(() => { /* 保留当前内存状态。 */ })
  return persistence
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * 启动时从加密存储水合内存缓存（2026-08-21 权衡修复）。
 * 必须在任何 getter 使用前调用（App 启动入口）；失败按未绑定处理。
 */
export function initDeviceBinding(): Promise<boolean> {
  if (hydrated) return Promise.resolve(!hydrationFailed)
  if (hydrationPromise) return hydrationPromise
  const generation = bindingGeneration
  hydrationPromise = (async () => {
    try {
      const [credRaw, sessRaw] = await Promise.all([
        secureStorage.getItem(CREDENTIAL_KEY),
        secureStorage.getItem(SESSION_KEY),
      ])
      const credential = parse<PdaDeviceCredential>(credRaw)
      const session = parse<PdaDeviceSession>(sessRaw)
      if ((credRaw && !credential) || (sessRaw && !session)) throw new Error('设备信息损坏')
      if (generation === bindingGeneration) {
        cachedCredential = credential
        cachedSession = credential ? session : null
      }
      hydrationFailed = false
      return true
    } catch {
      if (generation !== bindingGeneration) return true
      cachedCredential = null
      cachedSession = null
      hydrationFailed = true
      return false
    } finally {
      hydrated = true
      hydrationPromise = null
    }
  })()
  return hydrationPromise
}

export function getDeviceCredential(): PdaDeviceCredential | null {
  if (!hydrated) return null
  return cachedCredential
}

export function saveDeviceCredential(deviceCode: string, deviceSecret: string) {
  const payload: PdaDeviceCredential = {
    deviceCode: deviceCode.trim(),
    deviceSecret: deviceSecret.trim(),
    boundAt: new Date().toISOString(),
  }
  bindingGeneration++
  sessionRevision++
  cachedCredential = payload
  cachedSession = null
  return persistChange(async () => {
    await secureStorage.removeItem(SESSION_KEY)
    await secureStorage.setItem(CREDENTIAL_KEY, JSON.stringify(payload))
  })
}

/** 解绑：凭据和票据一起清掉，回到未绑定状态 */
export function clearDeviceBinding() {
  bindingGeneration++
  sessionRevision++
  cachedCredential = null
  cachedSession = null
  return persistChange(async () => {
    await secureStorage.removeItem(CREDENTIAL_KEY)
    await secureStorage.removeItem(SESSION_KEY)
  })
}

export function getDeviceSession(): PdaDeviceSession | null {
  if (!cachedSession?.token) return null
  // 本地先按 expiresAt 判一次，省掉一次必然失败的请求；服务端仍会独立校验
  if (cachedSession.expiresAt && new Date(cachedSession.expiresAt).getTime() <= Date.now()) return null
  return cachedSession
}

export function saveDeviceSession(session: PdaDeviceSession) {
  sessionRevision++
  cachedSession = session
  return persistChange(() => secureStorage.setItem(SESSION_KEY, JSON.stringify(session)))
}

export function clearDeviceSession() {
  sessionRevision++
  cachedSession = null
  return persistChange(() => secureStorage.removeItem(SESSION_KEY))
}

/**
 * 解析绑定二维码。只接受本系统自己生成的格式，扫到别的码给明确提示，
 * 不做"尽力猜"——猜错会把一串无关内容当成密钥存下来，后面报的错更难懂。
 */
export function parseBindingPayload(raw: string): { deviceCode: string; deviceSecret: string } | null {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (parsed?.t !== 'flowcube-pda-bind') return null
    if (!parsed.code || !parsed.secret) return null
    return { deviceCode: String(parsed.code), deviceSecret: String(parsed.secret) }
  } catch {
    return null
  }
}
