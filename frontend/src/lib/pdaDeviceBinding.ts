/**
 * PDA 设备绑定与设备会话票据
 *
 * 绑定：ERP 里登记设备拿到「设备码 + 密钥」，PDA 扫二维码把这对凭据存在本机。
 * 这对凭据是长期的，跟着机器走，换人登录不影响。
 *
 * 票据：每次登录后用凭据换一张设备会话票据（默认 30 天），之后所有请求都带上它。
 * 服务端据此知道「这台机器是谁、属于哪个仓」，绑了仓库的设备扫别仓单据会被直接拒。
 *
 * 存 localStorage 而不是 sessionStorage：设备身份必须在关掉 App、重启机器之后仍然有效，
 * 否则每次开机都要重新扫码绑定，现场没人受得了。票据泄漏的风险由「随时可在 ERP 停用设备
 * 并吊销全部票据」来兜底。
 */

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

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function getDeviceCredential(): PdaDeviceCredential | null {
  const value = readJson<PdaDeviceCredential>(CREDENTIAL_KEY)
  if (!value?.deviceCode || !value?.deviceSecret) return null
  return value
}

export function saveDeviceCredential(deviceCode: string, deviceSecret: string) {
  const payload: PdaDeviceCredential = {
    deviceCode: deviceCode.trim(),
    deviceSecret: deviceSecret.trim(),
    boundAt: new Date().toISOString(),
  }
  localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(payload))
}

/** 解绑：凭据和票据一起清掉，回到未绑定状态 */
export function clearDeviceBinding() {
  localStorage.removeItem(CREDENTIAL_KEY)
  localStorage.removeItem(SESSION_KEY)
}

export function getDeviceSession(): PdaDeviceSession | null {
  const value = readJson<PdaDeviceSession>(SESSION_KEY)
  if (!value?.token) return null
  // 本地先按 expiresAt 判一次，省掉一次必然失败的请求；服务端仍会独立校验
  if (value.expiresAt && new Date(value.expiresAt).getTime() <= Date.now()) return null
  return value
}

export function saveDeviceSession(session: PdaDeviceSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearDeviceSession() {
  localStorage.removeItem(SESSION_KEY)
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
