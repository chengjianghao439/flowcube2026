/**
 * FlowCube 桌面端：按任务绑定的逻辑打印机名称本机打 ZPL，并 POST complete-local 核销队列
 * 无需任何网口或 IP 配置；名称须与「从本机添加」时一致
 */
import apiClient from '@/api/client'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'

export function desktopLocalPrintRequestHeaders(): Record<string, string> {
  if (!IS_ELECTRON_DESKTOP) return {}
  return { 'X-Flowcube-Desktop-Local-Print': '1' }
}

export function isDesktopLocalPrintAvailable(): boolean {
  return (
    IS_ELECTRON_DESKTOP &&
    typeof window !== 'undefined' &&
    typeof window.flowcubeDesktop?.printZpl === 'function'
  )
}

export function hasDesktopZplTargetConfigured(printerName?: string | null): boolean {
  return Boolean(printerName != null && String(printerName).trim())
}

export async function printZplOnDesktop(
  content: string,
  opts: { printerName: string | null | undefined },
): Promise<void> {
  const printerName = opts.printerName != null ? String(opts.printerName).trim() : ''
  await window.flowcubeDesktop!.printZpl!({
    content,
    printerName,
  })
}

export type DesktopLocalPrintResult = 'skipped' | 'ok' | 'error'

export async function tryDesktopLocalZplThenComplete(opts: {
  jobId: number | null | undefined
  content?: string | null
  contentType?: string | null
  printerName?: string | null
}): Promise<DesktopLocalPrintResult> {
  if (!isDesktopLocalPrintAvailable()) return 'skipped'
  const { jobId, content, contentType, printerName } = opts
  if (!content || contentType !== 'zpl' || jobId == null || !Number.isFinite(Number(jobId))) {
    return 'skipped'
  }
  if (!hasDesktopZplTargetConfigured(printerName)) return 'skipped'
  try {
    await printZplOnDesktop(content, { printerName })
    await apiClient.post(`/print-jobs/${Number(jobId)}/complete-local`, {})
    return 'ok'
  } catch {
    return 'error'
  }
}
