import { isCancel } from 'axios'
import { getApiClientBaseURL, getApiClientBaseRevision, payloadClient as client } from './client'
import { useAuthStore } from '@/store/authStore'
import {
  getDeviceBindingGeneration,
  getDeviceCredential,
  getDeviceSession,
  getDeviceSessionRevision,
  saveDeviceSession,
  clearDeviceSession,
  clearDeviceBinding,
  type PdaDeviceSession,
} from '@/lib/pdaDeviceBinding'

interface CreateSessionResponse {
  session_token: string
  scopes: string[]
  expires_at: string | null
  warehouse_id: number | null
  warehouse_name?: string | null
}

const rejectedDeviceCredential = new Set(['PDA_DEVICE_SECRET_INVALID', 'PDA_DEVICE_NOT_ACTIVE', 'PDA_DEVICE_NOT_FOUND'])

function captureBinding() {
  const generation = getDeviceBindingGeneration()
  const loginGeneration = useAuthStore.getState().sessionGeneration
  const endpoint = getApiClientBaseURL()
  const endpointRevision = getApiClientBaseRevision()
  const session = getDeviceSession()
  let sessionRevision = getDeviceSessionRevision()
  const currentBinding = () => generation === getDeviceBindingGeneration()
    && loginGeneration === useAuthStore.getState().sessionGeneration
    && endpointRevision === getApiClientBaseRevision() && endpoint === getApiClientBaseURL()
  return {
    session,
    options: { baseURL: endpoint, skipGlobalError: true, _pdaBindingGeneration: generation, _authSessionGeneration: loginGeneration, _apiBaseRevision: endpointRevision },
    currentBinding,
    saveSession(next: PdaDeviceSession) {
      const persisted = saveDeviceSession(next)
      sessionRevision = getDeviceSessionRevision()
      return persisted
    },
    currentSession: () => currentBinding() && getDeviceSessionRevision() === sessionRevision,
  }
}

function fromResponse(data: CreateSessionResponse): PdaDeviceSession {
  return {
    token: data.session_token,
    warehouseId: data.warehouse_id ?? null,
    warehouseName: data.warehouse_name ?? null,
    expiresAt: data.expires_at ?? null,
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
  }
}

let exchangeInFlight: { current: () => boolean; promise: Promise<PdaDeviceSession | null> } | null = null

/** 使用当前绑定凭据换票。明确拒绝当前设备凭据时清除绑定，网络错误保留凭据。 */
export async function ensureDeviceSession(): Promise<PdaDeviceSession | null> {
  const credential = getDeviceCredential()
  if (!credential) return null
  if (exchangeInFlight?.current()) return exchangeInFlight.promise
  const binding = captureBinding()
  const flight = { current: binding.currentSession, promise: exchangeDeviceSession(credential, binding) }
  exchangeInFlight = flight
  try {
    return await flight.promise
  } finally {
    if (exchangeInFlight === flight) exchangeInFlight = null
  }
}

async function exchangeDeviceSession(credential: NonNullable<ReturnType<typeof getDeviceCredential>>, binding: ReturnType<typeof captureBinding>) {
  try {
    const data = await client.post<CreateSessionResponse>(
      '/pda/sessions',
      { device_code: credential.deviceCode, device_secret: credential.deviceSecret },
      binding.options,
    )
    if (!data?.session_token || !binding.currentSession()) return null
    const session = fromResponse(data)
    await binding.saveSession(session)
    return binding.currentBinding() && getDeviceSession() === session ? session : null
  } catch (error) {
    if (isCancel(error) || !binding.currentSession()) return null
    const code = (error as { code?: string | null })?.code
    if (code && rejectedDeviceCredential.has(code)) {
      await clearDeviceBinding()
    } else {
      console.warn('[device-session] 暂时无法取得设备票据', code ?? 'UNKNOWN')
    }
    return null
  }
}

/** 心跳只更新原登录、原绑定及原票据。失败只允许清理仍是本次请求持有的旧票据。 */
export async function renewDeviceSession(): Promise<PdaDeviceSession | null> {
  const binding = captureBinding()
  if (!binding.session?.token) return null
  try {
    const data = await client.post<CreateSessionResponse>(
      '/pda/sessions/renew',
      {},
      { ...binding.options, headers: { 'X-PDA-Session': binding.session.token } },
    )
    if (!data?.session_token || !binding.currentSession()) return null
    const session = fromResponse(data)
    await saveDeviceSession(session)
    return binding.currentBinding() && getDeviceSession() === session ? session : null
  } catch (error) {
    if (!isCancel(error) && binding.currentSession()) await clearDeviceSession()
    return null
  }
}
