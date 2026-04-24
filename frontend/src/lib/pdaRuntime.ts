/**
 * PDA 独立 App（Capacitor bundled）运行时：API 根地址、全局打印桥
 */
import { Capacitor } from '@capacitor/core'
import apiClient, { payloadClient } from '@/api/client'
import { API_BASE_STORAGE_KEY, normalizeApiBase } from '@/config/api'
import { ERP_PRODUCTION_ORIGIN, PDA_FALLBACK_API_ORIGIN } from '@/config/env'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/lib/toast'
import { getHashRouterWindowLocation } from '@/router/hashLocation'
import type { ApiResponse } from '@/types'

/** 标签打印机 ID（数字），供 window.printLabel 提交 print-jobs */
export const PDA_LABEL_PRINTER_ID_KEY = 'flowcube:pdaLabelPrinterId'

/**
 * 独立 PDA 的内置后端兜底地址。
 * 说明：
 * - 正常优先使用构建期注入的 VITE_ERP_PRODUCTION_ORIGIN
 * - 如需额外兜底，显式配置 VITE_PDA_FALLBACK_API_ORIGIN
 * - 不再内置固定公网地址，避免打包产物把测试/生产地址写死
 */
export function normalizePdaApiOrigin(raw: string): string {
  return normalizeApiBase(raw)
}

/** 扫码内容是否为可保存的后端根地址 */
export function tryParseScannedServerUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const o = normalizePdaApiOrigin(s)
  return o || null
}

/** Vite / preview 远程加载 PDA 时走相对 /api，勿覆盖 baseURL */
export function isPdaViteLiveHost(): boolean {
  if (typeof window === 'undefined') return false
  const p = window.location.port
  return (p === '5173' || p === '4173') && getHashRouterWindowLocation().pathname.startsWith('/pda')
}

/** APK 构建时注入的默认后端根（与桌面共用 VITE_ERP_PRODUCTION_ORIGIN） */
export function getBuiltPdaDefaultApiOrigin(): string {
  if (ERP_PRODUCTION_ORIGIN) return ERP_PRODUCTION_ORIGIN
  return normalizePdaApiOrigin(PDA_FALLBACK_API_ORIGIN)
}

function getStoredPdaApiOverride(): string {
  if (typeof window === 'undefined') return ''
  return normalizeApiBase(localStorage.getItem(API_BASE_STORAGE_KEY) || '')
}

/**
 * 独立 App 实际使用的 API 根：
 * - runtime override：API_BASE_URL
 * - build-time default：VITE_ERP_PRODUCTION_ORIGIN / VITE_PDA_FALLBACK_API_ORIGIN
 */
export function getResolvedPdaApiOrigin(): string {
  if (typeof window === 'undefined') return ''
  return getStoredPdaApiOverride() || getBuiltPdaDefaultApiOrigin()
}

export async function resolveHealthyPdaApiOrigin(): Promise<string> {
  return getResolvedPdaApiOrigin()
}

/** 将服务端返回的相对地址补成 PDA 可访问的绝对地址 */
export function resolvePdaServerUrl(pathOrUrl: string): string {
  const raw = pathOrUrl.trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) {
    if (typeof window !== 'undefined' && window.location?.protocol) {
      return `${window.location.protocol}${raw}`
    }
    return `https:${raw}`
  }

  if (raw.startsWith('/')) {
    if (Capacitor.isNativePlatform() && !isPdaViteLiveHost()) {
      const origin = getResolvedPdaApiOrigin()
      if (origin) return `${origin}${raw}`
    }
    if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
      return `${window.location.origin}${raw}`
    }
  }

  return raw
}

/** 根据 localStorage 设置 axios 基址（独立 APK bundled；Live 开发不覆盖） */
export async function applyPdaApiBaseFromStorage(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return ''
  if (isPdaViteLiveHost()) return ''

  const origin = await resolveHealthyPdaApiOrigin()
  if (origin) {
    apiClient.defaults.baseURL = `${origin}/api`
  }
  return origin
}

type PrinterBindingLike = {
  printer_id?: number
  printerId?: number
}

function readStoredPdaPrinterId(): number | null {
  const pid = Number(localStorage.getItem(PDA_LABEL_PRINTER_ID_KEY) || '')
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

/** 登录后自动读取容器标签打印机绑定，避免 PDA 手填 printerId */
export async function syncPdaLabelPrinterBinding(): Promise<number | null> {
  if (typeof window === 'undefined') return null
  const stored = readStoredPdaPrinterId()
  if (stored) return stored
  if (!useAuthStore.getState().token) return null

  try {
    const res = await payloadClient.get<{
      defaultBindings?: Record<string, PrinterBindingLike | undefined>
    }>('/printer-bindings', { skipGlobalError: true })
    const binding = res?.defaultBindings?.container_label
    const pid = Number(binding?.printer_id ?? binding?.printerId ?? '')
    if (Number.isFinite(pid) && pid > 0) {
      localStorage.setItem(PDA_LABEL_PRINTER_ID_KEY, String(pid))
      return pid
    }
  } catch {
    // keep silent; printing path will show explicit error if still unresolved
  }
  return null
}

/** 独立 App 已配置 API 根时检测后端是否可达（GET /api/health，无需登录） */
export async function checkPdaApiHealth(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || isPdaViteLiveHost()) return true
  const origin = await resolveHealthyPdaApiOrigin()
  if (!origin) return false
  try {
    const res = await fetch(`${origin}/api/health`, { method: 'GET', cache: 'no-store' })
    if (!res.ok) return false
    const j = (await res.json()) as { success?: boolean; status?: string }
    return j?.success === true && j?.status === 'ok'
  } catch {
    return false
  }
}

type PrintJobDetail = {
  id: number
  statusKey: 'pending' | 'printing' | 'success' | 'failed' | string
  errorMessage?: string | null
}

const PRINT_JOB_POLL_MS = 500
const PRINT_JOB_POLL_MAX_MS = 90_000

/** 轮询 GET /print-jobs/:id 直至 success / failed 或超时 */
async function waitPrintJobTerminal(jobId: number): Promise<{ ok: boolean; detail?: string }> {
  const t0 = Date.now()
  while (Date.now() - t0 < PRINT_JOB_POLL_MAX_MS) {
    try {
      const j = await payloadClient.get<ApiResponse<PrintJobDetail>>(`/print-jobs/${jobId}`, {
        skipGlobalError: true,
      })
      if (!j) return { ok: false, detail: '无法读取任务状态' }
      if (j.statusKey === 'success') return { ok: true }
      if (j.statusKey === 'failed') return { ok: false, detail: j.errorMessage?.trim() || undefined }
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 401) throw e instanceof Error ? e : new Error('未授权')
      if (status === 404) return { ok: false, detail: '打印任务不存在' }
    }
    await new Promise((resolve) => setTimeout(resolve, PRINT_JOB_POLL_MS))
  }
  return { ok: false, detail: '等待打印结果超时，请检查打印客户端与网络' }
}

/** 挂载 window.printLabel(zpl) → POST /print-jobs（ZPL 由后端队列 + 打印客户端执行） */
export function installPdaGlobals(): void {
  window.printLabel = async (zpl: string) => {
    const body = typeof zpl === 'string' ? zpl : ''
    if (!body.trim()) {
      toast.error('打印内容为空')
      return
    }
    if (!useAuthStore.getState().token) {
      toast.error('请先登录后再打印')
      return
    }
    const pid = readStoredPdaPrinterId() ?? await syncPdaLabelPrinterBinding()
    if (!pid) {
      toast.error('未找到容器标签打印机绑定，请先在后台打印机管理中配置')
      return
    }
    try {
      const res = await payloadClient.post<ApiResponse<{ id: number }>>(
        '/print-jobs',
        {
          printerId: pid,
          title: 'PDA 标签',
          content: body,
          contentType: 'zpl',
          copies: 1,
        },
        { skipGlobalError: true },
      )
      const jobId = res?.id
      if (!jobId) {
        toast.error('未返回打印任务 ID')
        return
      }
      const out = await waitPrintJobTerminal(jobId)
      if (out.ok) toast.success('✔ 已打印')
      else toast.error(out.detail ? `❌ 打印失败：${out.detail}` : '❌ 打印失败')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e instanceof Error ? e.message : '打印任务发送失败')
      toast.error(msg)
      throw e
    }
  }
}
