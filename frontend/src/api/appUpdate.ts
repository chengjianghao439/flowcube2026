import { payloadClient as client } from '@/api/client'

export interface AppUpdateLatestPayload {
  version: string
  notes: string
  url?: string | null
  filename?: string | null
}

export function getAppUpdateLatestApi() {
  return client.get<AppUpdateLatestPayload>('/app-update/latest', {
    skipGlobalError: true,
  })
}
