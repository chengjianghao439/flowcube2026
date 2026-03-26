import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/lib/toast'
import { performSessionLogout } from '@/lib/authSession'
import {
  collectErpApiFallbackCandidates,
  normalizeApiBase,
  probeErpApiOrigin,
  setApiBase,
} from '@/config/api'

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
    return config
  },
  (error) => Promise.reject(error),
)

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string; data?: PrintQuotaErrorPayload }>) => {
    const status  = error.response?.status
    const code    = error.code
    const rawMsg  = error.message
    const cfg     = error.config as InternalAxiosRequestConfig | undefined

    if (
      cfg
      && status == null
      && (code === 'ERR_NETWORK' || rawMsg === 'Network Error')
    ) {
      const switched = await tryErpApiFallbackAndRetry(cfg)
      if (switched) {
        return apiClient.request(cfg)
      }
    }

    let message =
      error.response?.data?.message
      ?? (status == null && (code === 'ERR_NETWORK' || rawMsg === 'Network Error')
        ? '无法连接服务器，请检查网络与后端地址（Ctrl+Shift+S 可配置 API）'
        : null)
      ?? (code === 'ECONNABORTED' ? '请求超时，请稍后重试' : null)
      ?? rawMsg
      ?? '请求失败'
    const payload = error.response?.data?.data

    if (status === 401) {
      performSessionLogout()
      return Promise.reject(new Error(message))
    }

    // skipGlobalError: true 时由调用方自行处理，不触发全局 toast
    if (!error.config?.skipGlobalError) {
      if (status === 429 && payload && typeof payload === 'object') {
        toast.error(formatPrintQuotaToast(message, payload))
      } else {
        toast.error(message)
      }
    }

    return Promise.reject(new Error(message))
  },
)

export default apiClient
