import axios from 'axios'
import { collectAllRecords, type RecordIdentityResolver } from './allRecords'
import { coordinateAuthRefresh, type RefreshResult } from './authRefreshCoordination'
import type { AxiosError, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { Capacitor } from '@capacitor/core'
import { IS_CAPACITOR_PDA } from '@/lib/platform'
import { useAuthStore } from '@/store/authStore'
import { useCompanyStore } from '@/store/companyStore'
import { isAccountingRequest } from '@/lib/companyScope'
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
import { resolveApiErrorMessage } from '@/utils/displayFormatters'
import { getDeviceBindingGeneration, getDeviceSession } from '@/lib/pdaDeviceBinding'
import { ensureDeviceSession, renewDeviceSession } from './pda-session'

/** 标记已为设备票据失效重试过一次，防止无限换票循环 */
type RetriableConfig = InternalAxiosRequestConfig & { __pdaSessionRetried?: boolean }
const isDeviceSessionRoute = (url = '') => /^\/pda\/sessions(?:\/renew)?(?:[?]|$)/.test(url)

/**
 * 用 refresh token 换新 access（2026-08-21 权衡修复）。
 * 同一会话/API 的并发 401 合并续期；会话已切换的旧结果作废，不能覆盖或登出新账号。
 */
// 独立实例不安装业务拦截器，refresh 的 401 不可递归续期。
const authRefreshClient = axios.create()
let apiBaseRevision = 0
let refreshInFlight: { sessionGeneration: number; refreshToken: string; baseURL: string | undefined; baseRevision: number; promise: Promise<RefreshResult> } | null = null
const revokedAccessCodes = new Set(['AUTH_SESSION_INVALID', 'AUTH_USER_NOT_FOUND', 'AUTH_USER_DISABLED'])
async function tryRefreshTokens(config: InternalAxiosRequestConfig): Promise<RefreshResult> {
  assertCurrentAuthSession(config)
  const { token, refreshToken, sessionGeneration } = useAuthStore.getState()
  if (!refreshToken) return { kind: 'unavailable' }
  const baseURL = config.baseURL ?? apiClient.defaults.baseURL
  const baseRevision = apiBaseRevision
  // 旧服务器的迟到401不能把原会话的刷新凭据发送到新服务器。
  if (baseURL !== apiClient.defaults.baseURL) return { kind: 'superseded' }
  if (refreshInFlight?.sessionGeneration === sessionGeneration && refreshInFlight.refreshToken === refreshToken
    && refreshInFlight.baseURL === baseURL && refreshInFlight.baseRevision === baseRevision) return refreshInFlight.promise
  const isCurrentSession = () => {
    const current = useAuthStore.getState()
    return current.sessionGeneration === sessionGeneration && current.token === token && current.refreshToken === refreshToken
      && apiClient.defaults.baseURL === baseURL && apiBaseRevision === baseRevision
  }
  const promise = coordinateAuthRefresh({
    scope: baseURL ?? '',
    refreshToken,
    isCurrent: isCurrentSession,
    rotate: async () => {
      try {
        const res = await authRefreshClient.post<{ data?: { token?: string; refreshToken?: string } }>(
          '/auth/refresh',
          { refreshToken },
          {
            baseURL,
            timeout: apiClient.defaults.timeout || 15000,
            headers: { 'Content-Type': 'application/json' },
          },
        )
        const data = res.data?.data
        if (typeof data?.token !== 'string' || !data.token || typeof data.refreshToken !== 'string'
          || !data.refreshToken || data.refreshToken === refreshToken) return { kind: 'unknown' }
        return { kind: 'success', token: data.token, refreshToken: data.refreshToken }
      } catch (error) {
        if (axios.isAxiosError<ApiErrorResponse>(error) && error.response?.status === 401) {
          const code = error.response.data?.code
          if (code === 'AUTH_REFRESH_INVALID' || code === 'AUTH_REFRESH_REPLAY') return { kind: 'revoked' }
        }
        // 代理错误和超时有可能发生在服务端已经完成一次性轮换之后。
        return { kind: 'unknown' }
      }
    },
  }).then((result): RefreshResult => {
    if (!isCurrentSession()) return { kind: 'superseded' }
    if (result.kind === 'success') useAuthStore.getState().setTokens(result.token, result.refreshToken)
    return result
  })
  const flight = { sessionGeneration, refreshToken, baseURL, baseRevision, promise }
  refreshInFlight = flight
  // 不让旧会话请求的结束清除新会话正在进行的续期。
  const clearFlight = () => { if (refreshInFlight === flight) refreshInFlight = null }
  void promise.then(clearFlight, clearFlight)
  return promise
}

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
    /**
     * 首页摘要显式使用单批；所有业务列表默认自动取齐。
     * `paged`：调用方自己按 page/offset 翻页，要求原样透传 page/pageSize（不取齐）。
     */
    listMode?: 'summary' | 'paged'
    skipGlobalError?: boolean
    /** 资源恢复请求显式由员工重试：禁地址fallback、认证/设备自动重放。默认其它调用保持。 */
    automaticReplay?: false
    /** ERP API fallback 已尝试过，避免循环重试 */
    _erpApiFallbackTried?: boolean
    /** 首次发起时绑定账套；续期重放不能改投另一账套。 */
    _companyScopeId?: number
    /** 首次派发的登录会话；正常令牌轮换不改变归属。禁止持久化。 */
    _authSessionGeneration?: number
    /** PDA 作业与换票均绑定原设备代次。 */
    _pdaBindingGeneration?: number
  }
}

function assertCurrentAuthSession(config?: AxiosRequestConfig): void {
  if (config?._authSessionGeneration != null && config._authSessionGeneration !== useAuthStore.getState().sessionGeneration) {
    throw new axios.CanceledError('登录状态已变化，请重新操作')
  }
}

function assertCurrentPdaBinding(config?: AxiosRequestConfig): void {
  if (config?._pdaBindingGeneration != null && config._pdaBindingGeneration !== getDeviceBindingGeneration()) {
    throw new axios.CanceledError('设备绑定已变化，请重新操作')
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
  if (config.automaticReplay === false || config._erpApiFallbackTried) return false
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
    assertCurrentAuthSession(config)
    setApiBase(n)
    const nextBase = `${n}/api`
    setApiClientBaseURL(nextBase)
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

const apiBaseURLListeners = new Set<() => void>()
export function getApiClientBaseRevision(): number { return apiBaseRevision }
export function getApiClientBaseURL(): string | undefined { return apiClient.defaults.baseURL }
export function subscribeApiClientBaseURL(listener: () => void): () => void {
  apiBaseURLListeners.add(listener)
  return () => { apiBaseURLListeners.delete(listener) }
}
/** Runtime改址统一入口：同步默认请求地址后通知依赖服务器身份的读取界面。 */
export function setApiClientBaseURL(baseURL: string | undefined): void {
  if (apiClient.defaults.baseURL === baseURL) return
  apiClient.defaults.baseURL = baseURL
  apiBaseRevision++
  for (const listener of apiBaseURLListeners) listener()
}

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    assertCurrentAuthSession(config)
    assertCurrentPdaBinding(config)
    const { token, sessionGeneration } = useAuthStore.getState()
    config._authSessionGeneration ??= sessionGeneration
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    // PDA 设备票据：绑定过的机器自动带上，服务端据此识别「哪台机器、属于哪个仓」。
    // 放在全局拦截器而不是逐个接口手加——设备身份要覆盖所有 PDA 作业请求，
    // 漏一个接口就等于那条路径上的跨仓拦截失效（X-Client 就是逐个手加的，很容易漏）。
    const deviceSession = getDeviceSession()
    const isPdaPage = typeof window !== 'undefined' && /^\/pda(?:\/|$)/.test(getHashRouterWindowLocation().pathname)
    if (deviceSession?.token || IS_CAPACITOR_PDA || isPdaPage || isDeviceSessionRoute(config.url)) {
      config._pdaBindingGeneration ??= getDeviceBindingGeneration()
    }
    if (deviceSession?.token && !(isDeviceSessionRoute(config.url) && config.headers.has('X-PDA-Session'))) {
      config.headers['X-PDA-Session'] = deviceSession.token
    }
    // 会计账套（文档10 多账套）：当前账套 id 注入头，后端 companyScope 中间件解析。
    // 只对会计相关接口有意义；非会计接口忽略该头。
    const companyId = useCompanyStore.getState().companyId
    if (isAccountingRequest(config.url)) {
      if (config._companyScopeId != null && config._companyScopeId !== companyId) throw new axios.CanceledError('账套已切换，请重新操作')
      config._companyScopeId ??= companyId
    }
    config.headers['X-Company-Id'] = String(config._companyScopeId ?? companyId)
    return config
  },
  (error) => { throw error },
  // 调用当下绑定会话，避免请求排入微任务后才捕获到紧随其后的新登录。
  { synchronous: true },
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
    assertCurrentAuthSession(response.config)
    assertCurrentPdaBinding(response.config)
    if (response.config._companyScopeId != null && response.config._companyScopeId !== useCompanyStore.getState().companyId) throw new axios.CanceledError('账套已切换，忽略旧结果')
    if (!isDeviceSessionRoute(response.config.url)) maybeRenewPdaSession()
    return response
  },
  async (error: AxiosError<ApiErrorResponse<PrintQuotaErrorPayload>>) => {
    if (axios.isCancel(error)) return Promise.reject(error)
    assertCurrentAuthSession(error.config)
    assertCurrentPdaBinding(error.config)
    if (error.config?._companyScopeId != null && error.config._companyScopeId !== useCompanyStore.getState().companyId) return Promise.reject(new axios.CanceledError('账套已切换，忽略旧结果'))
    // 二进制下载的业务错误仍是 JSON，恢复统一错误语义和续期流程。
    if (typeof Blob !== 'undefined' && error.response?.data instanceof Blob) {
      try { error.response.data = JSON.parse(await error.response.data.text()) } catch { /* 非 JSON 保留通用错误 */ }
    }
    assertCurrentAuthSession(error.config)
    const status  = error.response?.status
    const transportCode = error.code
    const rawMsg  = error.message
    const cfg     = error.config as InternalAxiosRequestConfig | undefined

    if (status === 401 && cfg && (cfg.baseURL ?? apiClient.defaults.baseURL) !== apiClient.defaults.baseURL) {
      return Promise.reject(new axios.CanceledError('服务器已变化，忽略原服务器登录结果'))
    }

    if (
      cfg
      && (cfg.method === 'get' || cfg.method === 'head')
      && status == null
      && (transportCode === 'ERR_NETWORK' || rawMsg === 'Network Error')
    ) {
      const switched = await tryErpApiFallbackAndRetry(cfg)
      assertCurrentAuthSession(cfg)
      if (switched) {
        return apiClient.request(cfg)
      }
    }

    // 设备票据失效（过期/被吊销/设备被停用）：用本机凭据自动换一张再重试一次。
    // 只重试一次并打标记，避免密钥已被重置时陷入「换票→仍失败→再换票」的死循环。
    if (
      cfg
      && cfg.automaticReplay !== false
      && !isDeviceSessionRoute(cfg.url)
      && status === 403
      && error.response?.data?.code === 'PDA_SESSION_REQUIRED'
      && !(cfg as RetriableConfig).__pdaSessionRetried
    ) {
      assertCurrentAuthSession(cfg)
      const renewed = await ensureDeviceSession()
      assertCurrentAuthSession(cfg)
      assertCurrentPdaBinding(cfg)
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
      ?? (transportCode === 'ECONNABORTED' ? '网络超时，请稍后重试' : null)
      ?? rawMsg
      ?? '操作失败，请稍后重试'
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
    // 通用码（CONFLICT/BUSINESS_ERROR…）不能覆盖后端中文原因，见 resolveApiErrorMessage
    const displayMessage = resolveApiErrorMessage(businessCode, message)
    const structuredError = new ApiClientError({
      message: displayMessage,
      status,
      code: normalizedCode,
      data: payload ?? null,
      response: error.response?.data ?? null,
    })

    // 打印工作站凭据由桌面端单独管理；其失效交给打印桥处理，保留ERP登录会话。
    if (status === 401 && (businessCode === 'PRINT_CLIENT_CREDENTIAL_INVALID'
      || (isDeviceSessionRoute(cfg?.url) && businessCode?.startsWith('PDA_')))) {
      return Promise.reject(structuredError)
    }

    if (status === 401 && cfg?.automaticReplay === false) return Promise.reject(structuredError)

    if (status === 401 && cfg && !/^\/auth\/(?:login|logout|refresh)(?:[/?]|$)/.test(cfg.url ?? '')) {
      const config401 = cfg as InternalAxiosRequestConfig & { __authRefreshed?: boolean }
      const before = useAuthStore.getState()
      const revoked = businessCode != null && revokedAccessCodes.has(businessCode)
      const canRenew = (businessCode == null && !isDeviceSessionRoute(config401.url))
        || businessCode === 'AUTH_TOKEN_EXPIRED' || businessCode === 'AUTH_TOKEN_INVALID'
      if ((revoked || canRenew) && before.token && config401.headers.get('Authorization') !== `Bearer ${before.token}`) {
        if (config401.__authRefreshed) return Promise.reject(structuredError)
        config401.__authRefreshed = true
        return apiClient.request(config401)
      }
      const expiredWithoutRefresh = businessCode === 'AUTH_TOKEN_EXPIRED' && !before.refreshToken
      if (before.token && (revoked || expiredWithoutRefresh)) {
        performSessionLogout()
        return Promise.reject(structuredError)
      }
      if (!config401.__authRefreshed && before.refreshToken && canRenew) {
        const refreshed = await tryRefreshTokens(config401)
        assertCurrentAuthSession(config401)
        if (refreshed.kind === 'superseded') return Promise.reject(new axios.CanceledError('登录会话或服务器已变化'))
        if (refreshed.kind === 'success') {
          config401.__authRefreshed = true
          return apiClient.request(config401)
        }
        if (refreshed.kind === 'revoked') {
          performSessionLogout()
          return Promise.reject(structuredError)
        }
        const unknown = refreshed.kind === 'unknown'
        const message = unknown ? '登录续期结果待确认，当前输入已保留。' : '暂时无法续期，当前输入已保留。'
        if (!config401.skipGlobalError) toast.error(message)
        return Promise.reject(new ApiClientError({
          message, status: 503,
          code: unknown ? 'AUTH_REFRESH_OUTCOME_UNKNOWN' : 'AUTH_REFRESH_UNAVAILABLE',
        }))
      }
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
  // 身份策略只属于列表汇总层，作为独立参数，不进入 Axios 配置或网络载荷。
  get<T = unknown>(url: string, config?: AxiosRequestConfig, identityOf?: RecordIdentityResolver) {
    // `paged` 与 `summary` 都不进取齐分支：下面那段会 delete 掉外部 page/pageSize、
    // 改由 collectAllRecords 从第 1 页重算，于是**调用方传的 page=2 永远发不出去**
    // （点「加载更多」只会又请求一次第 1 页）。分页接口必须原样透传。
    if (config?.listMode === 'summary' || config?.listMode === 'paged' || config?.responseType === 'blob' || config?.responseType === 'arraybuffer') {
      return payloadRequest(apiClient.get<T>(url, config))
    }
    // 在整次列表读取开始时绑定会话/账套，避免续批随用户切换而混入另一范围。
    const fixedConfig: AxiosRequestConfig = {
      ...config,
      _authSessionGeneration: config?._authSessionGeneration ?? useAuthStore.getState().sessionGeneration,
      ...(isAccountingRequest(url) ? { _companyScopeId: config?._companyScopeId ?? useCompanyStore.getState().companyId } : {}),
    }
    const [path, query = ''] = url.split('?')
    const queryParams = new URLSearchParams(query)
    const params = config?.params instanceof URLSearchParams ? Object.fromEntries(config.params) : { ...config?.params }
    const hasBatchParams = 'page' in params || 'pageSize' in params || queryParams.has('page') || queryParams.has('pageSize')
    delete params.page; delete params.pageSize
    queryParams.delete('page'); queryParams.delete('pageSize')
    const encodedQuery = queryParams.toString()
    const requestUrl = encodedQuery ? `${path}?${encodedQuery}` : path
    return collectAllRecords((page, pageSize, snapshotId) => payloadRequest(apiClient.get<T>(requestUrl, {
      ...fixedConfig,
      params: { ...params, ...(snapshotId ? { snapshotId } : {}), ...(hasBatchParams || page > 1 ? { page, pageSize: pageSize ?? 200 } : {}) },
    })), config?.signal, undefined, identityOf).catch((error: unknown) => {
      // 传输错误已由拦截器提示；这里只补完整性校验失败，不能静默显示残缺/空列表。
      if (!config?.skipGlobalError && !(error instanceof ApiClientError) && !axios.isCancel(error)
        && !(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error(error instanceof Error ? error.message : '列表加载失败，请刷新后重试')
      }
      throw error
    })
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
