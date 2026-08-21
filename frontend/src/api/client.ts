import axios from 'axios'
import type { AxiosError, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { Capacitor } from '@capacitor/core'
import { IS_CAPACITOR_PDA } from '@/lib/platform'
import { useAuthStore } from '@/store/authStore'
import { useCompanyStore } from '@/store/companyStore'
import { toast } from '@/lib/toast'
import { performSessionLogout } from '@/lib/authSession'
import type { ApiErrorResponse, ApiResponse } from '@/types'
import {
  collectErpApiFallbackCandidates,
  hasUserConfiguredApiOrigin,
  normalizeApiBase,
  probeErpApiOrigin,
  setApiBase,
} from '@/config/api'
import { getHashRouterWindowLocation } from '@/router/hashLocation'
import { formatBackendCode, formatErrorMessage } from '@/utils/displayFormatters'
import { getDeviceSession } from '@/lib/pdaDeviceBinding'
import { ensureDeviceSession, renewDeviceSession } from './pda-session'

/** 标记已为设备票据失效重试过一次，防止无限换票循环 */
type RetriableConfig = InternalAxiosRequestConfig & { __pdaSessionRetried?: boolean }

/** 独立 APK：勿走 ERP 浏览器的候选地址回退（易误连占位域名或 localhost） */
function isNativePdaNoViteLive(): boolean {
  if (typeof window === 'undefined') return false
  if (!Capacitor.isNativePlatform()) return false
  const port = window.location.port
  const path = getHashRouterWindowLocation().pathname
  if ((port === '5173' || port === '4173') && path.startsWith('/pda')) return false
  return true
}

interface PrintQuotaErrorPayload {
  code?: string
  hint?: string
  usage?: {
    queue?: { current?: number; limit?: number | null; remaining?: number | null }
    monthly?: {
      printedCopies?: number
      pipelineCopies?: number
      committedCopies?: number
      quota?: number | null
      remaining?: number | null
      afterNewJobCopies?: number
    }
  }
}

export class ApiClientError<T = unknown> extends Error {
  status?: number
  code?: string | null
  data?: T | null
  response?: ApiErrorResponse<T> | null

  constructor({
    message,
    status,
    code,
    data,
    response,
  }: {
    message: string
    status?: number
    code?: string | null
    data?: T | null
    response?: ApiErrorResponse<T> | null
  }) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code ?? null
    this.data = data ?? null
    this.response = response ?? null
  }
}

function formatPrintQuotaToast(message: string, p: PrintQuotaErrorPayload) {
  const parts: string[] = [message]
  if (typeof p.hint === 'string' && p.hint) parts.push(p.hint)
  const q = p.usage?.queue
  if (q && q.limit != null) {
    parts.push(`队列 ${q.current ?? '—'}/${q.limit}，剩余 ${q.remaining ?? '—'}`)
  }
  const m = p.usage?.monthly
  if (m && m.quota != null) {
    parts.push(`月度印量 已占用 ${m.committedCopies ?? '—'}/${m.quota}，剩余 ${m.remaining ?? '—'}`)
  }
  return parts.join(' · ')
}

/**
 * 在 AxiosRequestConfig 上扩展 skipGlobalError 字段。
 * 当请求方已有精细化 onError 处理且不希望触发全局 toast 时，
 * 可在调用时传入 { skipGlobalError: true }。
 */
declare module 'axios' {
  interface AxiosRequestConfig {
    skipGlobalError?: boolean
    /** ERP API fallback 已尝试过，避免循环重试 */
    _erpApiFallbackTried?: boolean
  }
}

function originFromAxiosConfig(config: InternalAxiosRequestConfig): string | null {
  const base = (config.baseURL ?? apiClient.defaults.baseURL ?? '/api') as string
  if (base.startsWith('http')) {
    try {
      const u = new URL(base)
      return `${u.protocol}//${u.host}`
    } catch {
      return null
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return window.location.origin
  }
  return null
}

async function tryErpApiFallbackAndRetry(config: InternalAxiosRequestConfig): Promise<boolean> {
  if (config._erpApiFallbackTried) return false
  config._erpApiFallbackTried = true
  // PDA 场景（真机 APK 或 dev:pda / build:pda 的 Vite live）不走 ERP 候选地址回退：
  // PDA 的 API 基址由 pdaRuntime 统一管理（真机用 resolveHealthyPdaApiOrigin，Vite live 走相对 /api 代理），
  // 让 ERP fallback 改 baseURL 会把心跳/请求引到外部地址（生产/localhost:3000），脱离 Vite 代理后本机不可达 → 断网。
  if (IS_CAPACITOR_PDA) return false
  if (hasUserConfiguredApiOrigin()) return false

  const failedOrigin = originFromAxiosConfig(config)
  for (const origin of collectErpApiFallbackCandidates()) {
    const n = normalizeApiBase(origin)
    if (!n) continue
    if (failedOrigin && n === failedOrigin) continue
    if (!(await probeErpApiOrigin(n))) continue
    setApiBase(n)
    const nextBase = `${n}/api`
    apiClient.defaults.baseURL = nextBase
    config.baseURL = nextBase
    return true
  }
  return false
}

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    // PDA 设备票据：绑定过的机器自动带上，服务端据此识别「哪台机器、属于哪个仓」。
    // 放在全局拦截器而不是逐个接口手加——设备身份要覆盖所有 PDA 作业请求，
    // 漏一个接口就等于那条路径上的跨仓拦截失效（X-Client 就是逐个手加的，很容易漏）。
    const deviceSession = getDeviceSession()
    if (deviceSession?.token) {
      config.headers['X-PDA-Session'] = deviceSession.token
    }
    // 会计账套（文档10 多账套）：当前账套 id 注入头，后端 companyScope 中间件解析。
    // 只对会计相关接口有意义；非会计接口忽略该头。
    const companyId = useCompanyStore.getState().companyId
    if (companyId !== 1) {
      config.headers['X-Company-Id'] = String(companyId)
    }
    return config
  },
  (error) => Promise.reject(error),
)

// PDA 票据心跳续期（2026-08-21 审计修复）：7 天 TTL 下活跃使用需持续顺延失效窗口。
// 低频触发（约每 4 小时一次、且仅 PDA 端）避免每次请求都续期；静默失败由
// 403 自动换票路径兜底。
let lastPdaRenewAt = 0
const PDA_RENEW_INTERVAL_MS = 4 * 60 * 60 * 1000
function maybeRenewPdaSession() {
  if (!IS_CAPACITOR_PDA) return
  const now = Date.now()
  if (now - lastPdaRenewAt < PDA_RENEW_INTERVAL_MS) return
  lastPdaRenewAt = now
  renewDeviceSession().catch(() => { /* 静默：失败走 403 换票兜底 */ })
}

apiClient.interceptors.response.use(
  (response) => {
    maybeRenewPdaSession()
    return response
  },
  async (error: AxiosError<ApiErrorResponse<PrintQuotaErrorPayload>>) => {
    const status  = error.response?.status
    const transportCode = error.code
    const rawMsg  = error.message
    const cfg     = error.config as InternalAxiosRequestConfig | undefined

    if (
      cfg
      && status == null
      && (transportCode === 'ERR_NETWORK' || rawMsg === 'Network Error')
    ) {
      const switched = await tryErpApiFallbackAndRetry(cfg)
      if (switched) {
        return apiClient.request(cfg)
      }
    }

    // 设备票据失效（过期/被吊销/设备被停用）：用本机凭据自动换一张再重试一次。
    // 只重试一次并打标记，避免密钥已被重置时陷入「换票→仍失败→再换票」的死循环。
    if (
      cfg
      && status === 403
      && error.response?.data?.code === 'PDA_SESSION_REQUIRED'
      && !(cfg as RetriableConfig).__pdaSessionRetried
    ) {
      const renewed = await ensureDeviceSession()
      if (renewed?.token) {
        ;(cfg as RetriableConfig).__pdaSessionRetried = true
        cfg.headers = cfg.headers ?? {}
        ;(cfg.headers as Record<string, string>)['X-PDA-Session'] = renewed.token
        return apiClient.request(cfg)
      }
    }

    const message =
      error.response?.data?.message
      ?? (status == null && (transportCode === 'ERR_NETWORK' || rawMsg === 'Network Error')
        ? isNativePdaNoViteLive()
          ? '无法连接服务器，请检查网络与内置服务器地址是否可达'
          : '无法连接服务器，请检查网络与后端服务是否正常'
        : null)
      ?? (transportCode === 'ECONNABORTED' ? '请求超时，请稍后重试' : null)
      ?? rawMsg
      ?? '请求失败'
    const payload = error.response?.data?.data
    const businessCode = error.response?.data?.code ?? null
    const normalizedCode =
      businessCode
      ?? (status === 401 ? 'UNAUTHORIZED' : null)
      ?? (status === 403 ? 'FORBIDDEN' : null)
      ?? (status === 404 ? 'NOT_FOUND' : null)
      ?? (status === 409 ? 'CONFLICT' : null)
      ?? (transportCode === 'ECONNABORTED' ? 'REQUEST_TIMEOUT' : null)
      ?? (transportCode === 'ERR_NETWORK' ? 'NETWORK_ERROR' : null)
      ?? null
    const displayMessage = businessCode
      ? formatBackendCode(businessCode, formatErrorMessage(message))
      : formatErrorMessage(message)
    const structuredError = new ApiClientError({
      message: displayMessage,
      status,
      code: normalizedCode,
      data: payload ?? null,
      response: error.response?.data ?? null,
    })

    if (status === 401) {
      performSessionLogout()
      return Promise.reject(structuredError)
    }

    // skipGlobalError: true 时由调用方自行处理，不触发全局 toast
    if (!error.config?.skipGlobalError) {
      if ((status === 429 || normalizedCode === 'PRINT_QUOTA_EXCEEDED') && payload && typeof payload === 'object') {
        toast.error(formatPrintQuotaToast(displayMessage, payload))
      } else {
        toast.error(displayMessage)
      }
    }

    return Promise.reject(structuredError)
  },
)

type PayloadOf<T> = T extends ApiResponse<infer P> ? P : T

export function unwrapPayload<T>(response: AxiosResponse<T>): PayloadOf<T> {
  const body = response.data as T
  if (
    body &&
    typeof body === 'object' &&
    'success' in (body as Record<string, unknown>) &&
    'data' in (body as Record<string, unknown>)
  ) {
    return (body as unknown as ApiResponse<PayloadOf<T>>).data
  }
  return body as PayloadOf<T>
}

async function payloadRequest<T>(request: Promise<AxiosResponse<T>>): Promise<PayloadOf<T>> {
  return unwrapPayload(await request)
}

export const payloadClient = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig) {
    return payloadRequest(apiClient.get<T>(url, config))
  },
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return payloadRequest(apiClient.post<T>(url, data, config))
  },
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return payloadRequest(apiClient.put<T>(url, data, config))
  },
  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return payloadRequest(apiClient.patch<T>(url, data, config))
  },
  delete<T = unknown>(url: string, config?: AxiosRequestConfig) {
    return payloadRequest(apiClient.delete<T>(url, config))
  },
}

export default apiClient
