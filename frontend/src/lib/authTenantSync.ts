import { useAuthStore } from '@/store/authStore'
import { getMeApi, refreshAccessTokenApi } from '@/api/auth'

/** 解码 JWT payload（不校验签名，仅用于判断是否含 tenantId 声明） */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const json = atob(b64 + pad)
    const normalized = json.replace(/^\uFEFF/, '').trim()
    if (import.meta.env.DEV) {
      console.warn('[decodeJwtPayload] 解析前 length=', normalized.length, 'preview=', JSON.stringify(normalized.slice(0, 120)))
    }
    return JSON.parse(normalized) as Record<string, unknown>
  } catch (e) {
    console.error('[decodeJwtPayload] JSON.parse 失败:', e instanceof Error ? e.message : e)
    if (import.meta.env.DEV) {
      try {
        const part = token.split('.')[1]
        if (part) {
          const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
          const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
          console.error('[decodeJwtPayload] 解码后全文(DEV):', atob(b64 + pad))
        }
      } catch {
        /* ignore */
      }
    }
    return null
  }
}

/**
 * 升级旧 JWT（无 tenantId）→ 调 refresh 换新令牌；并拉取 /me 同步 user.tenantId。
 * 在持久化登录恢复后调用一次即可。
 */
export async function syncTenantSession(): Promise<void> {
  const { token, user, login, updateUser } = useAuthStore.getState()
  if (!token) return

  const payload = decodeJwtPayload(token)
  const claimMissing = payload == null || !Object.prototype.hasOwnProperty.call(payload, 'tenantId')

  if (claimMissing) {
    const { token: newToken } = await refreshAccessTokenApi()
    useAuthStore.setState({ token: newToken, isAuthenticated: true })
    const me = await getMeApi()
    login(newToken, me)
    return
  }

  if (user && user.tenantId === undefined) {
    const me = await getMeApi()
    updateUser(me)
  }
}
