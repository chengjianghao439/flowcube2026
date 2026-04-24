import { payloadClient as apiClient } from './client'
import type { User } from '@/types'

export interface LoginParams {
  username: string
  password: string
}

export interface LoginResult {
  token: string
  user: User
}

export async function loginApi(params: LoginParams): Promise<LoginResult> {
  const res = await apiClient.post<LoginResult>('/auth/login', params)
  return res
}

export async function getMeApi(): Promise<User> {
  const res = await apiClient.get<User>('/auth/me')
  return res
}

/** 在旧 Token 仍有效时换新 JWT，供打印客户端与 Web 升级会话 */
export async function refreshAccessTokenApi(): Promise<{ token: string }> {
  const res = await apiClient.post<{ token: string }>('/auth/refresh', {}, { skipGlobalError: true })
  return res
}
