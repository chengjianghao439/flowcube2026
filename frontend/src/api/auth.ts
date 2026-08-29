import { payloadClient as apiClient } from './client'
import type { User } from '@/types'

export interface LoginParams {
  username: string
  password: string
}

export interface LoginResult {
  token: string
  /** refresh token（2026-08-21 权衡修复）：access 过期后自动换新 */
  refreshToken?: string | null
  user: User
}

export async function loginApi(params: LoginParams): Promise<LoginResult> {
  const res = await apiClient.post<LoginResult>('/auth/login', params)
  return res
}

/**
 * 登出：作废服务端 refresh token（一次性轮换配套）。fire-and-forget，
 * 失败（网络断开/access 已失效）不阻断本地登出——refresh 过期后自然失效。
 */
export async function logoutApi(refreshToken?: string | null): Promise<void> {
  if (!refreshToken) return
  try {
    await apiClient.post<null>('/auth/logout', { refreshToken }, { skipGlobalError: true })
  } catch {
    /* 忽略：登出无需保证服务端一定成功 */
  }
}
