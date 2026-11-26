import { getApiClientBaseURL } from '@/api/client'

export function currentApiEndpoint() {
  const raw = getApiClientBaseURL() ?? '/api'
  try { return new URL(raw, window.location.origin).href.replace(/\/$/, '') } catch { return raw.replace(/\/$/, '') }
}
