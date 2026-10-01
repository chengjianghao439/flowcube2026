// @vitest-environment jsdom
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient from './client'
import { repackPlasticBoxApi } from './inventory'
import { getOperationRequestStatusApi } from './operation-requests'
import { getPlasticBoxApi } from '@/hooks/usePlasticBoxes'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types'
const fallback = vi.hoisted(() => ({ candidates: vi.fn(() => ['https://fallback.test']), probe: vi.fn(async () => true), set: vi.fn() }))
vi.mock('@/config/api', () => ({ hasUserConfiguredApiOrigin: () => false, collectErpApiFallbackCandidates: fallback.candidates, probeErpApiOrigin: fallback.probe, normalizeApiBase: (origin: string) => origin, setApiBase: fallback.set }))
vi.mock('@/lib/platform', () => ({ IS_CAPACITOR_PDA: false }))
vi.mock('@/lib/pdaDeviceBinding', () => ({ getDeviceSession: () => null }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
const calls: InternalAxiosRequestConfig[] = []
let networkFail = false
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; networkFail = false
  useAuthStore.getState().login('test', null, { id: 1, roleId: 1 } as User)
  apiClient.defaults.baseURL = '/api'
  apiClient.defaults.adapter = async config => {
    calls.push({ ...config })
    if (networkFail && config.baseURL !== 'https://fallback.test/api') throw new AxiosError('Network Error', 'ERR_NETWORK', config)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: config.method === 'post' ? { boxId: 4, created: [] } : { status: 'pending', data: null } } }
  }
})
afterEach(() => useAuthStore.getState().logout())

test.each([undefined, 'pda'] as const)('既有 repack 第四参数 %s 和普通默认端点/请求键兼容', async client => {
  await repackPlasticBoxApi(4, { perBoxQty: 20, boxCount: 2 }, 'original', client)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ baseURL: '/api', url: '/plastic-boxes/4/repack', skipGlobalError: true, data: JSON.stringify({ perBoxQty: 20, boxCount: 2 }) })
  expect(calls[0].headers['X-Request-Key']).toBe('original')
  expect(calls[0].headers['X-Client']).toBe(client)
  expect(calls[0]._erpApiFallbackTried).toBeUndefined()
})
test('既有普通回执查询保留原路由/动作，无固定端点或fallback标记', async () => {
  await getOperationRequestStatusApi('original', 'plastic_box.repack.4')
  expect(calls[0]).toMatchObject({ baseURL: '/api', url: '/system/request-status/original', params: { action: 'plastic_box.repack.4' }, skipGlobalError: true })
  expect(calls[0]._erpApiFallbackTried).toBeUndefined()
})
test.each(['post', 'query', 'detail'])('恢复 %s 固定原端点和会话，网络错误不探测/改投候选地址', async kind => {
  networkFail = true
  const config = { baseURL: 'https://original.test/api', _erpApiFallbackTried: true, _authSessionGeneration: useAuthStore.getState().sessionGeneration, skipGlobalError: true }
  const request = kind === 'post' ? repackPlasticBoxApi(4, { items: [20] }, 'original', undefined, config) : kind === 'query' ? getOperationRequestStatusApi('original', 'plastic_box.repack.4', config) : getPlasticBoxApi(4, config)
  await expect(request).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject(config)
  expect(fallback.candidates).not.toHaveBeenCalled(); expect(fallback.probe).not.toHaveBeenCalled(); expect(fallback.set).not.toHaveBeenCalled()
  expect(apiClient.defaults.baseURL).toBe('/api')
})
test('普通 repack 的网络 fallback 契约保持，仍可探测并复用原请求键', async () => {
  networkFail = true
  await repackPlasticBoxApi(4, { items: [20] }, 'original')
  expect(calls.map(c => c.baseURL)).toEqual(['/api', 'https://fallback.test/api'])
  expect(calls.every(c => c.headers['X-Request-Key'] === 'original')).toBe(true)
  expect(fallback.probe).toHaveBeenCalledWith('https://fallback.test')
  expect(apiClient.defaults.baseURL).toBe('https://fallback.test/api')
})
