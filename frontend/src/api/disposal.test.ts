// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { AxiosAdapter, AxiosRequestConfig } from 'axios'
import { AxiosError } from 'axios'
import client, { setApiClientBaseURL } from './client'
import { disposeDisposalApi } from './disposal'
import { useAuthStore } from '@/store/authStore'
const oldAdapter = client.defaults.adapter
const configs: AxiosRequestConfig[] = []
afterEach(() => { client.defaults.adapter = oldAdapter; configs.length = 0; setApiClientBaseURL('/api'); useAuthStore.setState({ token: null, user: null, refreshToken: null }) })
describe('原报废请求固定配置', () => {
  it('POST冻结原endpoint/body/key且关闭自动重发；接口原DTO保留', async () => {
    client.defaults.adapter = (async config => { configs.push(config); return { data: { success: true, data: { id: 11, disposalNo: 'DP11', disposedValue: 10 } }, status: 200, statusText: 'OK', headers: {}, config } }) satisfies AxiosAdapter
    const result = await disposeDisposalApi(11, 'original', { baseURL: 'https://original.invalid/api', _authSessionGeneration: useAuthStore.getState().sessionGeneration })
    expect(result.id).toBe(11); expect(configs).toHaveLength(1); expect(configs[0].baseURL).toBe('https://original.invalid/api'); expect(configs[0].headers?.['X-Request-Key']).toBe('original'); expect(JSON.parse(String(configs[0].data))).toEqual({}); expect(configs[0].automaticReplay).toBe(false)
  })
  it.each([401, 403, 500])('本域%s不会刷新认证/换票或第二次POST，保持给原调用者核对', async status => {
    client.defaults.adapter = (async config => { configs.push(config); const response = { data: { success: false, code: status === 403 ? 'PDA_SESSION_REQUIRED' : undefined }, status, statusText: 'error', headers: {}, config }; throw new AxiosError('failed', undefined, config, undefined, response) }) satisfies AxiosAdapter
    useAuthStore.setState({ token: 'offline', refreshToken: null })
    await expect(disposeDisposalApi(11, 'original', { baseURL: '/api' })).rejects.toThrow(); expect(configs).toHaveLength(1); expect(useAuthStore.getState().token).toBe('offline')
  })
})
