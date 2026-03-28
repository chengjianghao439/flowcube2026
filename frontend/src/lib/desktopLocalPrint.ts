/**
 * FlowCube 桌面端：按任务绑定的逻辑打印机名称本机打 ZPL，并 POST complete-local 核销队列
 * 无需任何网口或 IP 配置；名称须与「从本机添加」时一致
 */
import axios from 'axios'
import apiClient from '@/api/client'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'

/**
 * 有本机打印桥接时带上，便于后端日志区分；货架 ZPL 现已在成功入队时始终返回。
 */
export function desktopLocalPrintRequestHeaders(): Record<string, string> {
  if (typeof window !== 'undefined' && typeof window.flowcubeDesktop?.printZpl === 'function') {
    return { 'X-Flowcube-Desktop-Local-Print': '1' }
  }
  if (IS_ELECTRON_DESKTOP) {
    return { 'X-Flowcube-Desktop-Local-Print': '1' }
  }
  return {}
}

export function isDesktopLocalPrintAvailable(): boolean {
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

export function hasDesktopZplTargetConfigured(printerName?: string | null): boolean {
  return Boolean(printerName != null && String(printerName).trim())
}

/** 送 RAW 前校验 ZPL 片段，避免空内容或残缺模板导致 silent 失败 */
export function validateZplForLocalPrint(content: string | null | undefined): string | null {
  const s = content != null ? String(content).trim() : ''
  if (!s) return 'ZPL 内容为空，无法本机打印'
  if (!s.includes('^XA') || !s.includes('^XZ')) {
    return 'ZPL 不完整（缺少 ^XA / ^XZ），无法送 RAW。请检查打印模板或联系管理员'
  }
  return null
}

/** TSPL 本机 RAW 校验 */
export function validateTsplForLocalPrint(content: string | null | undefined): string | null {
  const s = content != null ? String(content).trim() : ''
  if (!s) return 'TSPL 内容为空，无法本机打印'
  const u = s.toUpperCase()
  if (!u.includes('SIZE') || !u.includes('CLS') || !u.includes('PRINT')) {
    return 'TSPL 不完整（应含 SIZE、CLS、PRINT），无法送 RAW。请检查模板或打印机「指令集」是否为 TSPL'
  }
  return null
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

function formatDesktopPrintCatch(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const m = (e.response?.data as { message?: string } | undefined)?.message
    return (m || e.message || '').trim() || '网络或接口错误'
  }
  if (e instanceof Error && e.message.trim()) return e.message.trim()
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m.trim()
  }
  const s = String(e ?? '').trim()
  if (s && s !== '[object Object]') return s
  return '本机 RAW 打印失败：未收到具体原因。请打开桌面端主进程控制台，或核对打印机名称与 RAW 驱动。'
}

/** skipped_no_desktop：非桌面端或未注入 flowcubeDesktop；skipped_no_payload：桌面端可用但接口未带回 zpl/jobId，未送 RAW */
export type DesktopLocalPrintResult =
  | 'skipped_no_desktop'
  | 'skipped_no_payload'
  | 'ok'
  | { error: string }

export function isDesktopLocalPrintError(
  r: DesktopLocalPrintResult,
): r is { error: string } {
  return typeof r === 'object' && r !== null && 'error' in r
}

export async function tryDesktopLocalZplThenComplete(opts: {
  jobId: number | null | undefined
  content?: string | null
  contentType?: string | null
  printerName?: string | null
}): Promise<DesktopLocalPrintResult> {
  if (!isDesktopLocalPrintAvailable()) return 'skipped_no_desktop'
  const { jobId, content, contentType, printerName } = opts
  const ct = String(contentType || '').toLowerCase()
  if (!content || (ct !== 'zpl' && ct !== 'tspl') || jobId == null || !Number.isFinite(Number(jobId))) {
    return 'skipped_no_payload'
  }
  if (!hasDesktopZplTargetConfigured(printerName)) {
    return {
      error:
        'ERP 中该打印机未配置本机队列名称。请在「设置 → 打印机管理」使用「从本机添加」选择标签机，并绑定「库存标签」等用途；名称必须与 Windows/系统「打印机」列表中的名称完全一致。',
    }
  }
  const body = String(content).trimStart()
  const bodyU = body.toUpperCase()
  const looksZpl = body.includes('^XA') && body.includes('^XZ')
  const looksTspl =
    bodyU.includes('SIZE') && bodyU.includes('CLS') && bodyU.includes('PRINT')
  if (ct === 'tspl' && looksZpl) {
    return {
      error:
        '下发内容为 ZPL（含 ^XA/^XZ），但当前按 TSPL 标记。请在「打印机管理」将该标签机的 **RAW 指令集** 改为 **ZPL** 并保存；若已改过仍如此，请硬刷新浏览器（Ctrl+Shift+R）或检查是否连错环境/数据库。',
    }
  }
  if (
    ct === 'zpl' &&
    /^\s*SIZE\s+/i.test(body) &&
    bodyU.includes('PRINT') &&
    bodyU.includes('CLS') &&
    !looksZpl
  ) {
    return {
      error:
        '下发内容为 TSPL（以 SIZE 开头），但当前按 ZPL 标记。请在「打印机管理」将 **RAW 指令集** 改为 **TSPL** 并保存后再打印。',
    }
  }
  const rawErr = ct === 'tspl' ? validateTsplForLocalPrint(content) : validateZplForLocalPrint(content)
  if (rawErr) return { error: rawErr }
  try {
    await printZplOnDesktop(String(content).trim(), { printerName })
    await apiClient.post(`/print-jobs/${Number(jobId)}/complete-local`, {})
    return 'ok'
  } catch (e) {
    return { error: formatDesktopPrintCatch(e) }
  }
}
