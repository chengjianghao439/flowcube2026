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
