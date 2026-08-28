import { payloadClient as client } from './client'
import {
  getDeviceCredential,
  getDeviceSession,
  saveDeviceSession,
  clearDeviceSession,
  clearDeviceBinding,
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
 *
 * 2026-08-28 区分失败原因（此前一律静默 null，绑定页误报「密钥无效」）：
 *   - 网络/传输层错误（ERR_NETWORK/无响应/超时）→ 可能 baseURL 被误覆盖（旧 bug）
 *     或真网络问题，凭据**保留**（不是凭据的错），返回 null 且挂 warning 供诊断；
 *   - 业务拒绝（401 PADA_DEVICE_SECRET_INVALID / 403 PDA_DEVICE_NOT_ACTIVE 等）→
 *     凭据确实无效，走 clearDeviceBinding 提示重新生成二维码。
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
    await saveDeviceSession(session)
    return session
  } catch (e) {
    // 先判业务拒绝：凭据确实是错的（或设备被停用）→ 连凭据一起清掉，
    // 否则用户会保留一份必错的凭据，后续每个请求都失败更难排查。
    const status = (e as { status?: number })?.status
    const code = (e as { code?: string | null })?.code
    const businessRejected = status === 401 || status === 403
      || code === 'PDA_DEVICE_SECRET_INVALID' || code === 'PDA_DEVICE_NOT_ACTIVE'
      || code === 'PDA_DEVICE_NOT_FOUND'
    if (businessRejected) {
      await clearDeviceBinding()
      return null
    }
    // 网络/传输层失败：不是凭据的错，保留凭据与票据，避免误清后用户还得重扫。
    // baseURL 若被误覆盖成 WebView localhost（2026-08-28 修复前），这里会失败——
    // 暴露原错误让绑定页/控制台可诊断，而不是把用户引导去「重新生成二维码」。
    console.warn('[device-session] 换票失败（网络/基址）：', e)
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
    await saveDeviceSession(renewed)
    return renewed
  } catch {
    await clearDeviceSession()
    return null
  }
}
