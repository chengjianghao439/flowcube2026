import { payloadClient as client } from './client'
import {
  getDeviceCredential,
  getDeviceSession,
  saveDeviceSession,
  clearDeviceSession,
  type PdaDeviceSession,
} from '@/lib/pdaDeviceBinding'

interface CreateSessionResponse {
  session_token: string
  scopes: string[]
  expires_at: string | null
  warehouse_id: number | null
}

/**
 * 用本机存的设备凭据换一张会话票据。
 *
 * 登录成功后调用一次；票据失效（过期/被吊销/设备被停用）时再自动调一次。
 * 未绑定设备时直接返回 null——此时后端若处于观察模式仍可作业，处于强制模式则会
 * 明确提示去绑定，两种情况都不该在这里抛错打断登录流程。
 */
export async function ensureDeviceSession(): Promise<PdaDeviceSession | null> {
  const credential = getDeviceCredential()
  if (!credential) return null
  try {
    const data = await client.post<CreateSessionResponse>(
      '/pda/sessions',
      { device_code: credential.deviceCode, device_secret: credential.deviceSecret },
      { skipGlobalError: true },
    )
    if (!data?.session_token) return null
    const session: PdaDeviceSession = {
      token: data.session_token,
      warehouseId: data.warehouse_id ?? null,
      expiresAt: data.expires_at ?? null,
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
    }
    saveDeviceSession(session)
    return session
  } catch {
    // 建会话失败的原因（密钥被重置、设备被停用、网络不通）在这里区分不了也不该猜，
    // 清掉旧票据即可：真正的原因会在后续业务请求里由服务端明确告知。
    clearDeviceSession()
    return null
  }
}

/**
 * 心跳续期（2026-08-21 审计修复）：用现有票据换新票据，把 7 天 TTL 的失效窗口
 * 在活跃使用期间持续顺延；设备长期不用自然过期，需重新扫码或凭据换票。
 * 静默失败：网络抖动/票据恰好失效时清掉旧票据，后续请求会走 403 自动换票路径。
 */
export async function renewDeviceSession(): Promise<PdaDeviceSession | null> {
  const session = getDeviceSession()
  if (!session?.token) return null
  try {
    const data = await client.post<CreateSessionResponse>(
      '/pda/sessions/renew',
      {},
      { skipGlobalError: true, headers: { 'X-PDA-Session': session.token } },
    )
    if (!data?.session_token) return null
    const renewed: PdaDeviceSession = {
      token: data.session_token,
      warehouseId: data.warehouse_id ?? null,
      expiresAt: data.expires_at ?? null,
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
    }
    saveDeviceSession(renewed)
    return renewed
  } catch {
    clearDeviceSession()
    return null
  }
}
