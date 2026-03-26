/**
 * ERP 首次启动：静默探测可用 API，首个成功的地址写入 localStorage（不 toast）。
 */
import apiClient from '@/api/client'
import {
  collectErpApiFallbackCandidates,
  probeErpApiOrigin,
  probeRelativeErpApi,
  setApiBase,
} from '@/config/api'
import { applyErpApiBaseFromStorage, isFileProtocol } from '@/lib/apiOrigin'

export async function bootstrapErpApiConnection(): Promise<void> {
  applyErpApiBaseFromStorage()

  if (!isFileProtocol()) {
    const base = (apiClient.defaults.baseURL || '').replace(/\/$/, '')
    if (base === '/api') {
      if (await probeRelativeErpApi()) return
    }
  }

  for (const origin of collectErpApiFallbackCandidates()) {
    if (await probeErpApiOrigin(origin)) {
      setApiBase(origin)
      applyErpApiBaseFromStorage()
      return
    }
  }
}
