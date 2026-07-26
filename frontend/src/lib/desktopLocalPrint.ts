/**
 * 极序 Flow 桌面端本机打印的环境探测与上报工具。
 *
 * 物理打印本身只由桌面轮询客户端（DesktopPrintClientBridge）执行 —— 业务页面负责入队后
 * 调 triggerPrintPoll() 唤醒它（见 lib/printQueue）。本文件不再提供「页面直接打印」的入口，
 * 那条并行路径曾与轮询争抢同一任务、导致同一张标签被打印两次。
 */
import axios from 'axios'
import { payloadClient as apiClient } from '@/api/client'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'
import { getDesktopClientId } from '@/lib/printQueue'

/**
 * 打印入队请求头。
 * - X-Flowcube-Desktop-Local-Print：标识来自桌面端，便于后端日志区分
 * - X-Print-Client-Id：本机打印客户端标识，供后端做「在哪台电脑点的就从哪台电脑的打印机出纸」
 *   路由。商品标签这类没有仓库归属的打印尤其依赖它，否则会被派到其它仓库的机器上。
 */
export function desktopLocalPrintRequestHeaders(): Record<string, string> {
  const isDesktop =
    (typeof window !== 'undefined' && typeof window.flowcubeDesktop?.printZpl === 'function')
    || IS_ELECTRON_DESKTOP
  if (!isDesktop) return {}
  const headers: Record<string, string> = { 'X-Flowcube-Desktop-Local-Print': '1' }
  const clientId = getDesktopClientId()
  if (clientId) headers['X-Print-Client-Id'] = clientId
  return headers
}

function isDesktopLocalPrintAvailable(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.flowcubeDesktop?.printZpl === 'function'
  )
}

/** 本机 RAW 能否执行：浏览器内永远为 browser；桌面包内若预加载失败则为 electron_no_bridge */
export function getLocalPrintEnvironmentKind():
  | 'ok'
  | 'browser'
  | 'electron_no_bridge' {
  if (typeof window === 'undefined') return 'browser'
  if (isDesktopLocalPrintAvailable()) return 'ok'
  if (IS_ELECTRON_DESKTOP) return 'electron_no_bridge'
  return 'browser'
}

function isConflictError(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 409
}

/**
 * 打印终态上报（complete/fail）专用：网络卡顿时短退避重试；409（任务状态已变化）说明早前某次
 * 尝试其实已经生效（比如请求送达了但响应在回程丢失），视为已上报成功，不再重试也不算失败。
 */
export async function reportPrintOutcomeWithRetry(
  url: string,
  data: unknown,
  config?: { headers?: Record<string, string>; skipGlobalError?: boolean },
  attempts = 3,
): Promise<void> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      await apiClient.post(url, data, config)
      return
    } catch (e) {
      if (isConflictError(e)) return
      lastErr = e
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)))
      }
    }
  }
  throw lastErr
}
