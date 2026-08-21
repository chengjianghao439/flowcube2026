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
