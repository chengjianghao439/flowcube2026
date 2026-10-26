import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const session = vi.hoisted(() => ({ sessionGeneration: 1, token: 'synthetic-access' as string | null, refreshToken: 'synthetic-refresh' as string | null, setTokens: vi.fn(), logout: vi.fn() }))
vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => session } }))
vi.mock('@/store/companyStore', () => ({ useCompanyStore: { getState: () => ({ companyId: 1 }) } }))
vi.mock('@/lib/platform', () => ({ IS_CAPACITOR_PDA: false }))
vi.mock('@/lib/authSession', () => ({ performSessionLogout: session.logout }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/config/api', () => ({ hasUserConfiguredApiOrigin: () => true }))
vi.mock('@/lib/pdaDeviceBinding', () => ({ getDeviceSession: () => null }))
vi.mock('./pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn() }))

const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = axios.defaults.adapter
const ok = (config: InternalAxiosRequestConfig, data: unknown = { tasks: [] }) => ({ data: { success: true, message: 'ok', data }, status: 200, statusText: 'OK', headers: {}, config })
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); requests.length = 0
  session.sessionGeneration = 1; session.token = 'synthetic-access'; session.refreshToken = 'synthetic-refresh'
  session.setTokens.mockImplementation((token: string, refresh: string) => { session.token = token; session.refreshToken = refresh })
  axios.defaults.adapter = async config => { requests.push({ ...config, headers: new AxiosHeaders(config.headers) }); return ok(config) }
})
afterEach(() => { axios.defaults.adapter = originalAdapter; vi.unstubAllEnvs() })

test.each([['browser', '/api'], ['Electron file', 'https://erp.example.test/api'], ['local isolated server', 'http://127.0.0.1:3893/api']])('%s uses the current Flow API and normal auth envelope', async (_name, base) => {
  const { setApiClientBaseURL } = await import('./client')
  const { requestAssistant } = await import('./assistant')
  setApiClientBaseURL(base)
  vi.stubEnv('VITE_AGENT_URL', 'https://external.example.test/agent-api')
  expect(await requestAssistant('/tasks')).toEqual({ tasks: [] })
  expect(axios.getUri(requests[0])).toBe(`${base}/assistant/tasks`)
  expect(requests[0].headers.Authorization).toBe('Bearer synthetic-access')
  expect(requests[0]).toMatchObject({ timeout: 60000, skipGlobalError: true, _erpApiFallbackTried: true, _authSessionGeneration: 1 })
})

test('expired access renews through the same server and retries the original confirmation only', async () => {
  axios.defaults.adapter = async config => {
    requests.push({ ...config, headers: new AxiosHeaders(config.headers) })
    if (config.url === '/auth/refresh') return { ...ok(config), data: { data: { token: 'renewed-synthetic-access', refreshToken: 'renewed-synthetic-refresh' } } }
    if (config.headers.Authorization === 'Bearer synthetic-access') throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined, { ...ok(config), status: 401, data: { success: false, code: 'AUTH_TOKEN_EXPIRED', message: '登录已过期' } })
    return ok(config, { task: { id: 'original', state: 'DONE' } })
  }
  const { setApiClientBaseURL } = await import('./client')
  const { requestAssistant } = await import('./assistant')
  setApiClientBaseURL('https://erp.example.test/api')
  expect(await requestAssistant('/tasks/original/confirm', { revision: 2 })).toMatchObject({ task: { id: 'original', state: 'DONE' } })
  expect(requests.map(r => axios.getUri(r))).toEqual([
    'https://erp.example.test/api/assistant/tasks/original/confirm',
    'https://erp.example.test/api/auth/refresh',
    'https://erp.example.test/api/assistant/tasks/original/confirm',
  ])
  expect(requests.filter(r => r.url?.endsWith('/confirm')).map(r => JSON.parse(r.data))).toEqual([{ revision: 2 }, { revision: 2 }])
  expect(session.logout).not.toHaveBeenCalled()
})

test('lost confirmation response does not change server or replay a write', async () => {
  axios.defaults.adapter = async config => { requests.push(config); throw new AxiosError('Network Error', 'ERR_NETWORK', config) }
  const { setApiClientBaseURL, getApiClientBaseURL } = await import('./client')
  const { requestAssistant } = await import('./assistant')
  setApiClientBaseURL('/api')
  await expect(requestAssistant('/tasks/original/confirm', { revision: 3 })).rejects.toMatchObject({ status: 0 })
  expect(requests).toHaveLength(1)
  expect(getApiClientBaseURL()).toBe('/api')
})

test('server change during a request discards the old server result', async () => {
  let finish!: () => void
  axios.defaults.adapter = async config => { await new Promise<void>(resolve => { finish = resolve }); return ok(config, { reply: 'old private result' }) }
  const { setApiClientBaseURL } = await import('./client')
  const { requestAssistant } = await import('./assistant')
  setApiClientBaseURL('https://first.example.test/api')
  const pending = requestAssistant('/chat', { message: '极序流程' })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  setApiClientBaseURL('https://second.example.test/api'); finish()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})

test('changed login generation cannot accept an old result', async () => {
  let finish!: () => void
  axios.defaults.adapter = async config => { await new Promise<void>(resolve => { finish = resolve }); return ok(config, { reply: 'old private result' }) }
  const { requestAssistant } = await import('./assistant')
  const pending = requestAssistant('/tasks')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  session.sessionGeneration = 2; finish()
  await expect(pending).rejects.toBeDefined()
})

test('late 401 from a previous server cannot send a refresh credential to the new server', async () => {
  let finish!: () => void
  axios.defaults.adapter = async config => {
    requests.push(config)
    if (config.url === '/auth/refresh') return { ...ok(config), data: { data: { token: 'renewed-synthetic', refreshToken: 'next-synthetic' } } }
    if (requests.length > 1) return ok(config, { tasks: [] })
    await new Promise<void>(resolve => { finish = resolve })
    throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined, { ...ok(config), status: 401, data: { success: false, message: '登录已过期' } })
  }
  const { setApiClientBaseURL } = await import('./client')
  const { requestAssistant } = await import('./assistant')
  setApiClientBaseURL('https://first.example.test/api')
  const pending = requestAssistant('/tasks')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  setApiClientBaseURL('https://second.example.test/api'); finish()
  await expect(pending).rejects.toBeDefined()
  expect(requests).toHaveLength(1)
  expect(session.logout).not.toHaveBeenCalled()
})

test.each(['no refresh credential', 'already refreshed retry'])('old server 401 cannot log out the new server: %s', async variant => {
  let finish!: () => void
  if (variant === 'no refresh credential') session.refreshToken = null
  axios.defaults.adapter = async config => {
    requests.push({ ...config, headers: new AxiosHeaders(config.headers) })
    if (config.url === '/auth/refresh') return { ...ok(config), data: { data: { token: 'renewed-synthetic', refreshToken: 'next-synthetic' } } }
    if (variant === 'already refreshed retry' && config.headers.Authorization === 'Bearer synthetic-access') {
      throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined, { ...ok(config), status: 401, data: { success: false, message: '登录已过期' } })
    }
    await new Promise<void>(resolve => { finish = resolve })
    throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined, { ...ok(config), status: 401, data: { success: false, message: '登录已过期' } })
  }
  const { setApiClientBaseURL } = await import('./client')
  const { requestAssistant } = await import('./assistant')
  setApiClientBaseURL('https://first.example.test/api')
  const pending = requestAssistant('/tasks')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  setApiClientBaseURL('https://second.example.test/api'); finish()
  await expect(pending).rejects.toBeDefined()
  expect(session.logout).not.toHaveBeenCalled()
  expect(requests.every(r => r.baseURL === 'https://first.example.test/api')).toBe(true)
})

test('malformed successful response cannot look like a completed task', async () => {
  axios.defaults.adapter = async config => ({ ...ok(config), data: '<html>unavailable</html>' })
  const { requestAssistant } = await import('./assistant')
  await expect(requestAssistant('/chat', { message: '极序流程' })).rejects.toMatchObject({ status: 502 })
})
