// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import apiClient from './client'
import { getDocumentActivityApi } from './document-activity'
import { useAuthStore } from '@/store/authStore'
const originalAdapter = apiClient.defaults.adapter
const originalBaseURL = apiClient.defaults.baseURL
afterEach(() => { apiClient.defaults.adapter = originalAdapter; apiClient.defaults.baseURL = originalBaseURL; useAuthStore.getState().logout() })
test.each([false, true])('记录只读GET保留普通默认配置，成套显式固定原来源：%s', owned => {
  useAuthStore.setState({ token: 'test', user: { id: 5, roleId: 5 } as never, sessionGeneration: 10 })
  apiClient.defaults.baseURL = '/a'
  const calls: InternalAxiosRequestConfig[] = []
  const result = { status: '草稿', sections: [], events: [], historyNote: '历史记录提示' }
  apiClient.defaults.adapter = (async config => { calls.push(config); return { data: { success: true, data: result }, status: 200, statusText: 'OK', headers: {}, config } }) satisfies AxiosAdapter
  const signal = new AbortController().signal
  return getDocumentActivityApi('sale', 80, signal, owned ? { baseURL: '/a', userId: 5, sessionGeneration: 10 } : undefined).then(data => {
    expect(data).toEqual(result)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'get', url: '/document-activity/sale/80', baseURL: '/a', signal, skipGlobalError: true })
    expect(calls[0]._erpApiFallbackTried).toBe(owned ? true : undefined)
    if (owned) expect(calls[0]._authSessionGeneration).toBe(10)
    expect(calls[0].headers['X-Request-Key']).toBeUndefined()
  })
})
