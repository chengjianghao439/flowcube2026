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

export interface PdaDeviceCredential {
  deviceCode: string
  deviceSecret: string
  boundAt: string
}

export interface PdaDeviceSession {
  token: string
  warehouseId: number | null
  expiresAt: string | null
  scopes: string[]
}

// ── 内存缓存（同步 getter 的数据源）──────────────────────────────────────
let cachedCredential: PdaDeviceCredential | null = null
let cachedSession: PdaDeviceSession | null = null
let hydrated = false

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
export async function initDeviceBinding(): Promise<void> {
  try {
    const [credRaw, sessRaw] = await Promise.all([
      secureStorage.getItem(CREDENTIAL_KEY),
      secureStorage.getItem(SESSION_KEY),
    ])
    cachedCredential = parse<PdaDeviceCredential>(credRaw)
    cachedSession = parse<PdaDeviceSession>(sessRaw)
  } catch {
    cachedCredential = null
    cachedSession = null
  } finally {
    hydrated = true
  }
}

export function getDeviceCredential(): PdaDeviceCredential | null {
  if (!hydrated) return null
  return cachedCredential
}

export async function saveDeviceCredential(deviceCode: string, deviceSecret: string) {
  const payload: PdaDeviceCredential = {
    deviceCode: deviceCode.trim(),
    deviceSecret: deviceSecret.trim(),
    boundAt: new Date().toISOString(),
  }
  cachedCredential = payload
  try {
    await secureStorage.setItem(CREDENTIAL_KEY, JSON.stringify(payload))
  } catch {
    // 加密存储失败时仍保留内存态（本次会话可用），下次启动需重新绑定
  }
}

/** 解绑：凭据和票据一起清掉，回到未绑定状态 */
export async function clearDeviceBinding() {
  cachedCredential = null
  cachedSession = null
  try {
    await secureStorage.removeItem(CREDENTIAL_KEY)
    await secureStorage.removeItem(SESSION_KEY)
  } catch { /* ignore */ }
}

export function getDeviceSession(): PdaDeviceSession | null {
  if (!cachedSession?.token) return null
  // 本地先按 expiresAt 判一次，省掉一次必然失败的请求；服务端仍会独立校验
  if (cachedSession.expiresAt && new Date(cachedSession.expiresAt).getTime() <= Date.now()) return null
  return cachedSession
}

export async function saveDeviceSession(session: PdaDeviceSession) {
  cachedSession = session
  try {
    await secureStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // 内存态保留
  }
}

export async function clearDeviceSession() {
  cachedSession = null
  try {
    await secureStorage.removeItem(SESSION_KEY)
  } catch { /* ignore */ }
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
