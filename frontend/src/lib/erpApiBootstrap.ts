/**
 * ERP 首次启动：分别检查桌面固定地址、网页同源代理或已保存的地址。
 */
import {
  clearElectronStaleViteOrigins,
  getEffectiveApiOrigin,
  probeErpApiOrigin,
  probeRelativeErpApi,
} from '@/config/api'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
import { getElectronBridge } from '@/lib/platform'

export async function bootstrapErpApiConnection(): Promise<void> {
  clearElectronStaleViteOrigins()
  applyErpApiBaseFromStorage()

  const desktop = getElectronBridge()
  const origin = getEffectiveApiOrigin()
  if (origin) await probeErpApiOrigin(origin)
  else if (!desktop) await probeRelativeErpApi()

  // 供主进程按已解析地址触发自动更新。
  try {
    desktop?.notifyApiOriginReady?.(origin || '')
  } catch {
    /* 不影响 ERP 启动 */
  }
}
