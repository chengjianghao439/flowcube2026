// @vitest-environment jsdom
import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api, { getApiClientBaseURL, setApiClientBaseURL, subscribeApiClientBaseURL } from './client'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
import { applyPdaApiBaseFromStorage } from '@/lib/pdaRuntime'
import { API_BASE_STORAGE_KEY, setApiBase } from '@/config/api'
const runtime = vi.hoisted(() => ({ native: false }))
vi.mock('@capacitor/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => runtime.native } }
})
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn(async () => null) }))
vi.mock('@/config/api', async importOriginal => ({ ...await importOriginal<typeof import('@/config/api')>(), collectErpApiFallbackCandidates: () => ['https://fallback.test'], probeErpApiOrigin: async () => true }))
const adapter = api.defaults.adapter
let dispose: (() => void) | undefined
let observed: Array<string | undefined>
beforeEach(() => {
  localStorage.clear(); runtime.native = false; setApiClientBaseURL('/api'); observed = []
  dispose = subscribeApiClientBaseURL(() => observed.push(getApiClientBaseURL()))
})
afterEach(() => { dispose?.(); dispose = undefined; api.defaults.adapter = adapter; setApiClientBaseURL('/api'); localStorage.clear() })

test('共享setter保留Axios默认地址与请求行为，相同地址不通知，退订后不通知', async () => {
  const transport = vi.fn(async config => ({ config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: 'ok' } }))
  api.defaults.adapter = transport
  setApiClientBaseURL('https://server.test/api')
  setApiClientBaseURL('https://server.test/api')
  expect(observed).toEqual(['https://server.test/api'])
  await api.get('/fixture', { _erpApiFallbackTried: true })
  expect(transport.mock.calls[0]?.[0].baseURL).toBe('https://server.test/api')
  dispose?.(); setApiClientBaseURL('/next-api')
  expect(observed).toEqual(['https://server.test/api'])
})
test('真实ERP配置应用及清空同步地址通知，保留相对/api兼容', () => {
  setApiBase('https://erp.test'); applyErpApiBaseFromStorage()
  setApiBase(''); applyErpApiBaseFromStorage()
  expect(observed).toEqual(['https://erp.test/api', '/api'])
  expect(api.defaults.baseURL).toBe('/api')
})
test('真实PDA配置应用同步地址通知，非原生场景仍不覆盖ERP地址', async () => {
  localStorage.setItem(API_BASE_STORAGE_KEY, 'https://pda.test')
  expect(await applyPdaApiBaseFromStorage()).toBe(''); expect(observed).toEqual([])
  runtime.native = true
  expect(await applyPdaApiBaseFromStorage()).toBe('https://pda.test')
  expect(observed).toEqual(['https://pda.test/api'])
})
test('真实ERP网络fallback同步默认地址通知并仍按原端点重试', async () => {
  const requestedBases: Array<string | undefined> = []
  const transport = vi.fn(async config => {
    requestedBases.push(config.baseURL)
    if (config.baseURL === '/api') throw new AxiosError('Network Error', 'ERR_NETWORK', config)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: 'ok' } }
  })
  api.defaults.adapter = transport
  await api.get('/fixture', { skipGlobalError: true })
  expect(requestedBases).toEqual(['/api', 'https://fallback.test/api'])
  expect(observed).toEqual(['https://fallback.test/api'])
})
