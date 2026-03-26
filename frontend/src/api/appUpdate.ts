import client from '@/api/client'
import type { ApiResponse } from '@/types'

export interface AppUpdateLatestPayload {
  version: string
  notes: string
  url?: string | null
  filename?: string | null
}

export function getAppUpdateLatestApi() {
  return client.get<ApiResponse<AppUpdateLatestPayload>>('/app-update/latest', {
    skipGlobalError: true,
  })
}
