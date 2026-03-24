import apiClient from './client'
import type { ApiResponse, User } from '@/types'

export interface LoginParams {
  username: string
  password: string
}

export interface LoginResult {
  token: string
  user: User
}

export async function loginApi(params: LoginParams): Promise<LoginResult> {
  const res = await apiClient.post<ApiResponse<LoginResult>>('/auth/login', params)
  return res.data.data
}

export async function getMeApi(): Promise<User> {
  const res = await apiClient.get<ApiResponse<User>>('/auth/me')
  return res.data.data
}
