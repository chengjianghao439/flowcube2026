/**
 * FlowCube 桌面端：本机直连 ZPL，出纸后 POST complete-local 核销队列
 */
import apiClient from '@/api/client'

export const DESKTOP_LOCAL_ZPL_HOST_KEY = 'flowcube:desktopLocalZplHost'
export const DESKTOP_LOCAL_ZPL_PORT_KEY = 'flowcube:desktopLocalZplPort'
export const DESKTOP_LOCAL_ZPL_LP_KEY = 'flowcube:desktopLocalZplLp'

/** 请求体带此头时，货架打印等接口会额外返回 content（ZPL）供本机出纸 */
export function desktopLocalPrintRequestHeaders(): Record<string, string> {
  if (import.meta.env.VITE_ELECTRON !== '1') return {}
  return { 'X-Flowcube-Desktop-Local-Print': '1' }
}

export function isDesktopLocalPrintAvailable(): boolean {
  return (
    import.meta.env.VITE_ELECTRON === '1' &&
    typeof window !== 'undefined' &&
    typeof window.flowcubeDesktop?.printZpl === 'function'
  )
}

function readLocalZplOptions(): { host?: string; port: number; lpQueue?: string } {
  const host = localStorage.getItem(DESKTOP_LOCAL_ZPL_HOST_KEY)?.trim() || ''
  const portRaw = localStorage.getItem(DESKTOP_LOCAL_ZPL_PORT_KEY)
  const port = Number(portRaw) > 0 ? Number(portRaw) : 9100
  const lp = localStorage.getItem(DESKTOP_LOCAL_ZPL_LP_KEY)?.trim() || ''
  return {
    host: host || undefined,
    port,
    lpQueue: lp || undefined,
  }
}

/** 是否已配置可发送 ZPL 的目标（Windows 需网口 IP；macOS/Linux 可仅填 CUPS 队列） */
export function hasDesktopZplTargetConfigured(): boolean {
  const { host, lpQueue } = readLocalZplOptions()
  if (host) return true
  if (typeof navigator === 'undefined') return false
  const win = /Win/i.test(navigator.platform || '') || /Windows/i.test(navigator.userAgent || '')
  if (win) return false
  return Boolean(lpQueue)
}

export async function printZplOnDesktop(content: string): Promise<void> {
  const { host, port, lpQueue } = readLocalZplOptions()
  await window.flowcubeDesktop!.printZpl!({
    content,
    host,
    port,
    lpQueue,
  })
}

export type DesktopLocalPrintResult = 'skipped' | 'ok' | 'error'

/**
 * 本机打 ZPL 并核销队列；未配置目标或非桌面端时 skipped
 */
export async function tryDesktopLocalZplThenComplete(opts: {
  jobId: number | null | undefined
  content?: string | null
  contentType?: string | null
}): Promise<DesktopLocalPrintResult> {
  if (!isDesktopLocalPrintAvailable()) return 'skipped'
  const { jobId, content, contentType } = opts
  if (!content || contentType !== 'zpl' || jobId == null || !Number.isFinite(Number(jobId))) {
    return 'skipped'
  }
  if (!hasDesktopZplTargetConfigured()) return 'skipped'
  try {
    await printZplOnDesktop(content)
    await apiClient.post(`/print-jobs/${Number(jobId)}/complete-local`, {})
    return 'ok'
  } catch {
    return 'error'
  }
}
