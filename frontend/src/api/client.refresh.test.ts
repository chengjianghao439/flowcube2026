import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, expect, test, vi } from 'vitest'

const session = vi.hoisted(() => ({ sessionGeneration: 0, token: 'old' as string | null, refreshToken: 'refresh' as string | null, setTokens: vi.fn(), logout: vi.fn() }))
vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => session } }))
vi.mock('@/store/companyStore', () => ({ useCompanyStore: { getState: () => company } }))
vi.mock('@/lib/platform', () => ({ IS_CAPACITOR_PDA: false }))
vi.mock('@/lib/authSession', () => ({ performSessionLogout: session.logout }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/config/api', () => ({ hasUserConfiguredApiOrigin: () => true }))
vi.mock('@/lib/pdaDeviceBinding', () => ({ getDeviceSession: () => null }))
vi.mock('./pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn() }))

const company = vi.hoisted(() => ({ companyId: 1 }))
const requests: InternalAxiosRequestConfig[] = []
let failRefresh = false
let failReplay = false
let nextRefreshPause: Promise<void> | null = null
function unauthorized(config: InternalAxiosRequestConfig) {
  return new AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, undefined,
    { data: { message: 'unauthorized' }, status: 401, statusText: 'Unauthorized', config, headers: {} })
}
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  session.sessionGeneration = 1
  session.token = 'old'
  session.refreshToken = 'refresh'
  session.setTokens.mockImplementation((token: string, refresh: string) => { session.token = token; session.refreshToken = refresh })
  company.companyId = 1
  requests.length = 0
  failRefresh = false
  failReplay = false
  nextRefreshPause = null
  axios.defaults.adapter = async config => {
    requests.push({ ...config, headers: new AxiosHeaders(config.headers) })
    if (config.url?.endsWith('/auth/refresh')) {
      const pause = nextRefreshPause
      nextRefreshPause = null
      if (pause) await pause
      await new Promise(resolve => setTimeout(resolve, 5))
      if (failRefresh) throw unauthorized(config)
      return { data: { data: { token: 'new', refreshToken: 'next' } }, status: 200, statusText: 'OK', headers: {}, config }
    }
    if (config.headers.Authorization !== 'Bearer new' || failReplay) throw unauthorized(config)
    return { data: 'ok', status: 200, statusText: 'OK', headers: {}, config }
  }
})

test.each([
  ['browser', '/api'],
  ['desktop file origin', 'https://erp.example.test/api'],
  ['PDA localhost origin', 'https://pda.example.test/api'],
])('%s refresh uses the active API base and bounded timeout', async (_name, baseURL) => {
  const { default: api } = await import('./client')
  api.defaults.baseURL = baseURL
  api.defaults.timeout = 12345
  await api.get('/orders')
  const refresh = requests.find(r => r.url?.endsWith('/auth/refresh'))!
  expect(axios.getUri(refresh)).toBe(`${baseURL}/auth/refresh`)
  expect(refresh.timeout).toBe(12345)
  expect(session.logout).not.toHaveBeenCalled()
})

test('runtime API changes are used by the next refresh', async () => {
  const { default: api } = await import('./client')
  api.defaults.baseURL = 'https://first.example.test/api'
  await api.get('/orders')
  session.token = 'old'
  api.defaults.baseURL = 'https://second.example.test/api'
  await api.get('/orders')
  expect(requests.filter(r => r.url?.endsWith('/auth/refresh')).map(r => axios.getUri(r)))
    .toEqual(['https://first.example.test/api/auth/refresh', 'https://second.example.test/api/auth/refresh'])
})

test('concurrent 401 responses share one refresh and all replay', async () => {
  const { default: api } = await import('./client')
  await Promise.all([api.get('/one'), api.get('/two'), api.get('/three')])
  expect(requests.filter(r => r.url?.endsWith('/auth/refresh'))).toHaveLength(1)
  expect(requests.filter(r => r.headers.Authorization === 'Bearer new')).toHaveLength(3)
})

test.each(['refresh', 'replay'])('401 in %s terminates without a refresh loop', async failure => {
  const { default: api } = await import('./client')
  failRefresh = failure === 'refresh'
  failReplay = failure === 'replay'
  await expect(api.get('/orders')).rejects.toMatchObject({ status: 401 })
  expect(requests.filter(r => r.url?.endsWith('/auth/refresh'))).toHaveLength(1)
  expect(session.logout).toHaveBeenCalledOnce()
})

test('a 401 without a refresh token does not poison refresh after a later login', async () => {
  const { default: api } = await import('./client')
  session.refreshToken = null
  await expect(api.get('/orders')).rejects.toMatchObject({ status: 401 })
  session.token = 'old'
  session.refreshToken = 'new-login-refresh'
  await expect(api.get('/orders')).resolves.toMatchObject({ data: 'ok' })
  expect(requests.filter(r => r.url?.endsWith('/auth/refresh'))).toHaveLength(1)
})

test.each([
  ['logout', false], ['new login', false], ['logout', true], ['new login', true],
] as const)('a pending refresh after %s (refresh fails=%s) cannot replace or log out the current session', async (change, refreshFails) => {
  const { default: api } = await import('./client')
  let release!: () => void
  nextRefreshPause = new Promise(resolve => { release = resolve })
  const oldRequest = api.get('/orders').catch(error => error)
  await vi.waitFor(() => expect(requests.some(r => r.url?.endsWith('/auth/refresh'))).toBe(true))
  session.sessionGeneration += 1
  session.token = change === 'logout' ? null : 'other-access'
  session.refreshToken = change === 'logout' ? null : 'other-refresh'
  failRefresh = refreshFails
  release()
  expect(axios.isCancel(await oldRequest)).toBe(true)
  expect(session.setTokens).not.toHaveBeenCalled()
  expect(session.logout).not.toHaveBeenCalled()
  expect(session.token).toBe(change === 'logout' ? null : 'other-access')
  expect(requests.filter(r => r.url === '/orders')).toHaveLength(1)
})

test('a new session can refresh while the previous session refresh is still pending', async () => {
  const { default: api } = await import('./client')
  let release!: () => void
  nextRefreshPause = new Promise(resolve => { release = resolve })
  const oldRequest = api.get('/old-session').catch(error => error)
  await vi.waitFor(() => expect(requests.some(r => r.url?.endsWith('/auth/refresh'))).toBe(true))
  session.sessionGeneration += 1
  session.token = 'other-access'
  session.refreshToken = 'other-refresh'
  const currentRequest = api.get('/current-session').catch(error => error)
  try {
    await vi.waitFor(() => expect(requests.filter(r => r.url?.endsWith('/auth/refresh'))).toHaveLength(2))
    expect(await currentRequest).toMatchObject({ data: 'ok' })
  } finally { release(); await oldRequest; await currentRequest }
  expect(session.setTokens).toHaveBeenCalledOnce()
  expect(session.logout).not.toHaveBeenCalled()
})

test('会计导出续期保留原账套及二进制参数，返回主账套不沿用旧头', async () => {
  const { default: api } = await import('./client')
  company.companyId = 2
  await api.get('/export/fixed-assets', { responseType: 'blob' })
  expect(requests.filter(r => r.url === '/export/fixed-assets').map(r => [r.headers['X-Company-Id'], r.responseType])).toEqual([['2', 'blob'], ['2', 'blob']])
  company.companyId = 1
  await api.get('/accounting/vouchers', { headers: { 'X-Company-Id': '2' } })
  expect(requests.at(-1)?.headers['X-Company-Id']).toBe('1')
})

test('续期中切换账套取消旧请求，不重放到新账套', async () => {
  const { default: api } = await import('./client')
  let release!: () => void
  nextRefreshPause = new Promise(resolve => { release = resolve })
  company.companyId = 2
  const request = api.get('/export/fixed-assets', { responseType: 'blob' }).catch(e => e)
  try {
    await vi.waitFor(() => expect(requests.some(r => r.url === '/auth/refresh')).toBe(true))
    company.companyId = 1
  } finally { release() }
  expect(axios.isCancel(await request)).toBe(true)
  expect(requests.filter(r => r.url === '/export/fixed-assets')).toHaveLength(1)
})

test('旧账套迟到的成功响应不能进入新账套页面', async () => {
  const { default: api } = await import('./client')
  let release!: () => void
  const pause = new Promise<void>(resolve => { release = resolve })
  let started = false
  api.defaults.adapter = async config => { started = true; await pause; return { data: 'old', status: 200, statusText: 'OK', headers: {}, config } }
  company.companyId = 2
  const request = api.get('/fixed-assets').catch(e => e)
  try { await vi.waitFor(() => expect(started).toBe(true)); company.companyId = 1 } finally { release() }
  expect(axios.isCancel(await request)).toBe(true)
})
