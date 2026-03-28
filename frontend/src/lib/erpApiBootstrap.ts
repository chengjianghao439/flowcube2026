/**
 * ERP 首次启动：静默探测可用 API，首个成功的地址写入 localStorage（不 toast）。
 */
import apiClient from '@/api/client'
import {
  clearElectronStaleViteOrigins,
  collectErpApiFallbackCandidates,
  getApiBase,
  getUserConfiguredApiOriginsInOrder,
  hasUserConfiguredApiOrigin,
  probeErpApiOrigin,
  probeRelativeErpApi,
  setApiBase,
} from '@/config/api'
import { applyErpApiBaseFromStorage, isFileProtocol } from '@/lib/apiOrigin'

/** 供桌面主进程在 ERP 引导结束后触发自动更新（与 localStorage 写入时序对齐） */
function notifyDesktopApiOriginReady(): void {
  if (typeof window === 'undefined') return
  const d = window.flowcubeDesktop
  if (!d?.notifyApiOriginReady) return
  try {
    d.notifyApiOriginReady(getApiBase())
  } catch {
    /* ignore */
  }
}

export async function bootstrapErpApiConnection(): Promise<void> {
  clearElectronStaleViteOrigins()
  applyErpApiBaseFromStorage()

  if (!isFileProtocol()) {
    const base = (apiClient.defaults.baseURL || '').replace(/\/$/, '')
    if (base === '/api') {
      if (await probeRelativeErpApi()) {
        notifyDesktopApiOriginReady()
        return
      }
    }
  }

  if (hasUserConfiguredApiOrigin()) {
    for (const origin of getUserConfiguredApiOriginsInOrder()) {
      if (await probeErpApiOrigin(origin)) {
        setApiBase(origin)
        applyErpApiBaseFromStorage()
        notifyDesktopApiOriginReady()
        return
      }
    }
    notifyDesktopApiOriginReady()
    return
  }

  for (const origin of collectErpApiFallbackCandidates()) {
    if (await probeErpApiOrigin(origin)) {
      setApiBase(origin)
      applyErpApiBaseFromStorage()
      notifyDesktopApiOriginReady()
      return
    }
  }
  notifyDesktopApiOriginReady()
}
