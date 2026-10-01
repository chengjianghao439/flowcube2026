// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useCloseReceivingInbound } from './useInboundTasks'
import { useAuthStore } from '@/store/authStore'
const api = vi.hoisted(() => ({ close: vi.fn(), query: vi.fn(), invalidate: vi.fn(), defaults: { baseURL: 'http://local-a/api' } }))
vi.mock('@/api/inbound-tasks', () => ({ closeReceivingInboundApi: api.close }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.query }))
vi.mock('@/api/client', () => ({ default: { defaults: api.defaults } }))
vi.mock('@/hooks/useInvalidate', () => ({ useInvalidate: () => api.invalidate }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
let host: HTMLDivElement, root: Root, hook: ReturnType<typeof useCloseReceivingInbound>
function Harness() { hook = useCloseReceivingInbound(); return <div>{hook.pendingRecord?.taskId}</div> }
async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>))
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks(); api.defaults.baseURL = 'http://local-a/api'
  useAuthStore.setState({ sessionGeneration: 11, user: { id: 5, roleId: 1 } as never, token: 'fixture', isAuthenticated: true })
})
afterEach(async () => { await act(async () => root?.unmount()); host?.remove() })
test('超时保留原任务/key/action/端点，not_found仍未知，同键显式重试', async () => {
  api.close.mockRejectedValueOnce({ status: 504 }).mockResolvedValueOnce({ taskId: 7, status: 4 })
  api.query.mockResolvedValue({ status: 'not_found' })
  await mount(); await act(async () => { await hook.submit(7) })
  expect(hook.pendingRecord?.taskId).toBe(7)
  const original = api.close.mock.calls[0]
  api.defaults.baseURL = 'http://local-b/api'
  await act(async () => { await hook.check() })
  expect(api.query).toHaveBeenCalledWith(original[2], 'inbound.closeReceiving.7', expect.objectContaining({ baseURL: 'http://local-a/api', _erpApiFallbackTried: true }))
  expect(hook.pendingRecord?.taskId).toBe(7)
  await act(async () => { await hook.retry() })
  expect(api.close.mock.calls[1]).toEqual(original)
  expect(hook.pendingRecord).toBeNull()
})
test('未知期间另一任务不发送；不自洽回执保留未知', async () => {
  api.close.mockRejectedValue({ status: 504 }); api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 8, data: { taskId: 8, status: 4 } })
  await mount(); await act(async () => { await hook.submit(7); await hook.submit(8); await hook.check() })
  expect(api.close).toHaveBeenCalledTimes(1); expect(hook.pendingRecord?.taskId).toBe(7)
})
test('换账号/登录代次后旧响应不能确定成功或重试原操作', async () => {
  let resolve!: (r: unknown) => void
  api.close.mockImplementation(() => new Promise(r => { resolve = r }))
  await mount(); let pending!: ReturnType<typeof hook.submit>
  await act(async () => { pending = hook.submit(7) })
  useAuthStore.setState({ sessionGeneration: 12, user: { id: 6, roleId: 1 } as never })
  await act(async () => { resolve({ taskId: 7, status: 4 }); expect(await pending).toBeNull() })
  await act(async () => { await hook.retry(); await hook.check() })
  expect(api.close).toHaveBeenCalledTimes(1); expect(api.query).not.toHaveBeenCalled()
})
test('撤权后禁止重试，但本人查询原回执仍可确认阶段3', async () => {
  api.close.mockRejectedValue({ status: 504 }); api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 7, data: { taskId: 7, status: 3 } })
  await mount(); await act(async () => { await hook.submit(7) })
  useAuthStore.setState({ user: { id: 5, roleId: 5, permissions: [] } as never })
  await act(async () => { await hook.retry(); expect(await hook.check()).toEqual({ taskId: 7, status: 3 }) })
  expect(api.close).toHaveBeenCalledTimes(1)
})
test('未知提交同键重试遭4xx仍保留原键，可查询原成功', async () => {
  api.close.mockRejectedValueOnce({ status: 504 }).mockRejectedValueOnce({ status: 403 })
  api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 7, data: { taskId: 7, status: 4 } })
  await mount(); await act(async () => { await hook.submit(7) })
  const originalKey = hook.pendingRecord?.requestKey
  await act(async () => { await hook.retry() })
  expect(hook.pendingRecord?.requestKey).toBe(originalKey)
  await act(async () => { expect(await hook.check()).toEqual({ taskId: 7, status: 4 }) })
})
test('切换端点后的原成功不刷新或关闭新服务器视图', async () => {
  let resolve!: (r: unknown) => void
  api.close.mockImplementation(() => new Promise(r => { resolve = r }))
  await mount(); let pending!: ReturnType<typeof hook.submit>
  await act(async () => { pending = hook.submit(7) })
  api.defaults.baseURL = 'http://local-b/api'
  await act(async () => { resolve({ taskId: 7, status: 4 }); expect(await pending).toBeNull() })
  expect(api.invalidate).not.toHaveBeenCalled()
  expect(hook.pendingRecord).toBeNull()
})
test('显式错误资源归属的失败回执仍未知；原端点原键失败可确认', async () => {
  api.close.mockRejectedValue({ status: 504 })
  api.query.mockResolvedValueOnce({ status: 'failed', resourceType: 'inbound_task', resourceId: 8 }).mockResolvedValueOnce({ status: 'failed' })
  await mount(); await act(async () => { await hook.submit(7); await hook.check() })
  expect(hook.pendingRecord?.taskId).toBe(7)
  await act(async () => { await hook.check() })
  expect(hook.pendingRecord).toBeNull()
})
