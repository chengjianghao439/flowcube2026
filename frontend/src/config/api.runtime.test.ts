// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://portal.example.test/"}
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DisposalExecutionRecord } from '@/lib/disposalRecovery'

const runtime = vi.hoisted(() => ({ native: false }))
vi.mock('@capacitor/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@capacitor/core')>()
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => runtime.native },
    registerPlugin: () => ({}),
  }
})

const packagedOrigin = 'https://desktop-api.example.test'
const storageKey = 'API_BASE_URL'

function stubHealthyApi() {
  const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ success: true, status: 'ok' })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_ERP_PRODUCTION_ORIGIN', packagedOrigin)
  vi.stubEnv('VITE_ELECTRON', '1')
  vi.stubEnv('VITE_CAPACITOR', '0')
  runtime.native = false
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  delete window.flowcubeDesktop
  delete window.__FLOWCUBE_DEFAULT_API_ORIGIN__
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('共享 ERP 构建在普通浏览器中通过当前站点检查，登录后仍使用相对 API', async () => {
  const fetch = stubHealthyApi()
  const { bootstrapErpApiConnection } = await import('@/lib/erpApiBootstrap')
  const { getApiClientBaseURL } = await import('@/api/client')
  const { getApiBase, persistErpApiBaseAfterLogin } = await import('./api')
  const { applyErpApiBaseFromStorage } = await import('@/lib/apiOrigin')

  await bootstrapErpApiConnection()
  expect(fetch.mock.calls.map(call => call[0])).toEqual([`${window.location.origin}/api/health`])
  expect(getApiBase()).toBe(window.location.origin)
  expect(getApiClientBaseURL()).toBe('/api')

  persistErpApiBaseAfterLogin()
  applyErpApiBaseFromStorage()
  expect(getApiClientBaseURL()).toBe('/api')
  expect(localStorage.getItem(storageKey)).toBeNull()
})

test('网页可继续使用已有的显式 API 地址', async () => {
  const override = 'https://configured.example.test'
  localStorage.setItem('flowcube:apiOrigin', override)
  const fetch = stubHealthyApi()
  const { bootstrapErpApiConnection } = await import('@/lib/erpApiBootstrap')
  const { getApiClientBaseURL } = await import('@/api/client')

  await bootstrapErpApiConnection()
  expect(fetch.mock.calls.map(call => call[0])).toEqual([`${override}/api/health`])
  expect(getApiClientBaseURL()).toBe(`${override}/api`)
  expect(localStorage.getItem(storageKey)).toBe(override)
})

test.each([
  { description: '同源保存地址', injected: packagedOrigin, saveOrigin: true, base: `${window.location.origin}/api` },
  { description: '打包注入与网页同源', injected: window.location.origin, saveOrigin: false, base: `${window.location.origin}/api` },
  { description: '普通相对地址', injected: '', saveOrigin: false, base: '/api' },
])('网页保留由 $description 写入的待确认报废记录', async ({ injected, saveOrigin, base }) => {
  vi.stubEnv('VITE_ERP_PRODUCTION_ORIGIN', injected)
  if (saveOrigin) localStorage.setItem(storageKey, window.location.origin)
  const fetch = stubHealthyApi()
  const { bootstrapErpApiConnection } = await import('@/lib/erpApiBootstrap')
  const { getApiClientBaseURL } = await import('@/api/client')
  const { applyErpApiBaseFromStorage } = await import('@/lib/apiOrigin')
  const { collectErpApiFallbackCandidates, persistErpApiBaseAfterLogin } = await import('./api')
  const { useAuthStore } = await import('@/store/authStore')
  const { DISPOSAL_EXECUTION_STORAGE, ownDisposalRecords } = await import('@/lib/disposalRecovery')
  const pending: DisposalExecutionRecord = {
    version: 1, id: 42, userId: 9, baseURL: base,
    action: 'disposal.dispose.42', path: '/disposals/42/dispose', method: 'post',
    body: {}, requestKey: 'synthetic-pending-record', createdAt: Date.now(), phase: 'pending',
  }
  localStorage.setItem(DISPOSAL_EXECUTION_STORAGE, JSON.stringify([
    pending, { ...pending, baseURL: 'https://other-server.example.test/api' },
  ]))
  useAuthStore.getState().login('synthetic-session', null, {
    id: 9, username: 'fixture-operator', realName: '验收员工', roleId: 9, roleName: '验收',
  })

  await bootstrapErpApiConnection()
  persistErpApiBaseAfterLogin()
  applyErpApiBaseFromStorage()

  expect(fetch.mock.calls.map(call => call[0])).toEqual([`${window.location.origin}/api/health`])
  expect(getApiClientBaseURL()).toBe(base)
  expect(ownDisposalRecords()).toEqual({ records: [pending], error: '' })
  expect(collectErpApiFallbackCandidates()).toEqual(saveOrigin ? [window.location.origin] : [])
  expect(localStorage.getItem(storageKey)).toBe(saveOrigin ? window.location.origin : null)
})

test('同源注入仍优先于安装包历史忽略的另一地址', async () => {
  vi.stubEnv('VITE_ERP_PRODUCTION_ORIGIN', window.location.origin)
  localStorage.setItem(storageKey, 'https://previously-ignored.example.test')
  const fetch = stubHealthyApi()
  const { bootstrapErpApiConnection } = await import('@/lib/erpApiBootstrap')
  const { getApiClientBaseURL } = await import('@/api/client')
  const { collectErpApiFallbackCandidates, persistErpApiBaseAfterLogin } = await import('./api')

  await bootstrapErpApiConnection()
  persistErpApiBaseAfterLogin()
  expect(fetch.mock.calls.map(call => call[0])).toEqual([`${window.location.origin}/api/health`])
  expect(getApiClientBaseURL()).toBe(`${window.location.origin}/api`)
  expect(collectErpApiFallbackCandidates()).toEqual([])
  expect(localStorage.getItem(storageKey)).toBe('https://previously-ignored.example.test')
})

test('浏览器传输失败不会把原请求改投安装包服务器', async () => {
  const fetch = stubHealthyApi()
  const { default: client } = await import('@/api/client')
  const transport = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.baseURL === '/api') throw new AxiosError('Network Error', 'ERR_NETWORK', config)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true } }
  })
  client.defaults.adapter = transport

  await expect(client.post('/auth/login', {}, { skipGlobalError: true })).rejects.toThrow()
  expect(transport.mock.calls.map(([config]) => config.baseURL)).toEqual(['/api'])
  expect(fetch).not.toHaveBeenCalled()
})

test('Electron 预加载桥使用安装包 API，忽略遗留地址并通知更新流程', async () => {
  const notifyApiOriginReady = vi.fn()
  window.flowcubeDesktop = { isDesktop: true, notifyApiOriginReady }
  localStorage.setItem(storageKey, 'https://stale.example.test')
  const fetch = stubHealthyApi()
  const { bootstrapErpApiConnection } = await import('@/lib/erpApiBootstrap')
  const { getApiClientBaseURL } = await import('@/api/client')
  const { persistErpApiBaseAfterLogin } = await import('./api')

  await bootstrapErpApiConnection()
  persistErpApiBaseAfterLogin()
  expect(fetch.mock.calls.map(call => call[0])).toEqual([`${packagedOrigin}/api/health`])
  expect(getApiClientBaseURL()).toBe(`${packagedOrigin}/api`)
  expect(notifyApiOriginReady).toHaveBeenCalledExactlyOnceWith(packagedOrigin)
  expect(localStorage.getItem(storageKey)).toBeNull()
})

test.each([
  ['https://saved-desktop.example.test', 'https://saved-desktop.example.test'],
  ['http://localhost:5173', null],
])('Electron 缺内置 API 时仅认可可用的原保存地址 %s', async (stored, expected) => {
  vi.stubEnv('VITE_ERP_PRODUCTION_ORIGIN', '')
  window.flowcubeDesktop = { isDesktop: true }
  localStorage.setItem(storageKey, stored)
  const fetch = stubHealthyApi()
  const { bootstrapErpApiConnection } = await import('@/lib/erpApiBootstrap')
  const { getApiClientBaseURL } = await import('@/api/client')

  await bootstrapErpApiConnection()
  expect(getApiClientBaseURL()).toBe(expected ? `${expected}/api` : '/api')
  expect(fetch.mock.calls.map(call => call[0])).toEqual(expected ? [`${expected}/api/health`] : [])
})

test.each([false, true])('PDA 构建保护现有 API 选择（原生桥 %s）', async native => {
  vi.stubEnv('VITE_ELECTRON', '0')
  vi.stubEnv('VITE_CAPACITOR', '1')
  runtime.native = native
  const { getApiClientBaseURL } = await import('@/api/client')
  const { applyPdaApiBaseFromStorage } = await import('@/lib/pdaRuntime')
  const { persistErpApiBaseAfterLogin } = await import('./api')

  if (native) localStorage.setItem(storageKey, 'https://pda-configured.example.test')
  await applyPdaApiBaseFromStorage()
  persistErpApiBaseAfterLogin()
  expect(getApiClientBaseURL()).toBe(native ? 'https://pda-configured.example.test/api' : '/api')
  expect(localStorage.getItem(storageKey)).toBe(native ? 'https://pda-configured.example.test' : null)
})
