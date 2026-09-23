// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { installUnhandledRejectionReporting } from './unhandledRejection'
const dependencies = vi.hoisted(() => ({ post: vi.fn(), token: 'test-token' as string | null }))
vi.mock('@/api/client', () => ({ default: { post: dependencies.post } }))
vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({ token: dependencies.token }) } }))
let cleanup: (() => void) | undefined
function reject(reason: unknown) { const event = new Event('unhandledrejection', { cancelable: true }); Object.assign(event, { reason }); window.dispatchEvent(event); return event }
afterEach(() => { cleanup?.(); vi.restoreAllMocks(); vi.clearAllMocks(); dependencies.token = 'test-token' })
test('未配置 Sentry 的已认证异步异常上报固定分类，不带业务载荷及 URL 参数', async () => {
  dependencies.post.mockResolvedValue({}); vi.spyOn(console, 'error').mockImplementation(() => {})
  cleanup = installUnhandledRejectionReporting(false)
  const reason = { message: '客户密钥', config: { data: { customer: '真实姓名' } } }
  reject(reason)
  await vi.waitFor(() => expect(dependencies.post).toHaveBeenCalledOnce())
  const [url, body, options] = dependencies.post.mock.calls[0]
  expect(url).toBe('/system/error-report'); expect(options).toEqual({ skipGlobalError: true })
  expect(body).toEqual({ message: 'Unhandled Promise rejection', stack: '', componentStack: '', url: window.location.origin })
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('真实姓名')
  expect(console.error).toHaveBeenCalledWith('[UnhandledRejection] 未捕获的 Promise 错误')
})
test('配置 Sentry 时不重复上报也不拦截默认捕获', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  cleanup = installUnhandledRejectionReporting(true)
  expect(reject(new Error('secret')).defaultPrevented).toBe(false)
  expect(dependencies.post).not.toHaveBeenCalled()
})
test('匿名不上报，上报同步或异步失败不会产生新异常', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  cleanup = installUnhandledRejectionReporting(false)
  dependencies.token = null; reject('anonymous'); expect(dependencies.post).not.toHaveBeenCalled()
  dependencies.token = 'test-token'; dependencies.post.mockRejectedValueOnce(new Error('offline'))
  reject('async'); await Promise.resolve()
  dependencies.post.mockImplementationOnce(() => { throw new Error('sync') })
  expect(() => reject('sync')).not.toThrow()
})
