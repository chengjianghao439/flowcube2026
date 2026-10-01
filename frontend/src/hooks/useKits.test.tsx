// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { useKitWrite } from './useKits'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
const fixtures = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), defaults: { baseURL: '/api' } }))
vi.mock('@/api/kits', () => ({ createKitApi: fixtures.create, updateKitApi: fixtures.update, deleteKitApi: fixtures.remove, getKitsApi: vi.fn(), getKitApi: vi.fn() }))
vi.mock('@/api/client', () => ({ default: { defaults: fixtures.defaults } }))
let hook: ReturnType<typeof useKitWrite>
beforeEach(() => {
  vi.resetAllMocks(); fixtures.defaults.baseURL = '/api'
  useAuthStore.setState({ token: 'unit-test-only', sessionGeneration: 10, user: { id: 1, username: 'fixture', realName: '测试', roleId: 5, roleName: '测试', permissions: [PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_DELETE] } })
})
async function withHook(run: () => Promise<void>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); const root = createRoot(host); const query = new QueryClient()
  function Probe() { hook = useKitWrite(); return null }
  try { await act(async () => root.render(<QueryClientProvider client={query}><Probe /></QueryClientProvider>)); await run() }
  finally { act(() => root.unmount()); query.clear() }
}
const operation = () => ({ kind: 'update' as const, id: 7, data: { revision: 3, referenceUnitPrice: 100 } })
const result = { id: 7, revision: 4, currentVersionId: 20, version: { id: 20, versionNo: 3 } }
test('超时冻结原载荷/键/端点；输入变化不创建新请求；同键重试成功返回server版本', async () => withHook(async () => {
  fixtures.update.mockRejectedValueOnce(new Error('超时')).mockResolvedValueOnce(result)
  const op = operation()
  await act(async () => { await hook.submit(op) })
  const first = fixtures.update.mock.calls[0]
  expect(hook.pendingRecord).not.toBeNull()
  op.data.referenceUnitPrice = 999; fixtures.defaults.baseURL = '/other'
  await act(async () => { await hook.submit(op) })
  expect(fixtures.update).toHaveBeenCalledTimes(1)
  fixtures.defaults.baseURL = '/api'
  let returned: unknown
  await act(async () => { returned = await hook.retry() })
  expect(fixtures.update.mock.calls[1]).toEqual(first)
  expect(first[1]).toEqual({ revision: 3, referenceUnitPrice: 100 })
  expect(returned).toEqual(result); expect(hook.pendingRecord).toBeNull()
}))
test('首次409是终态保留错误；unknown后的409不能释放原键', async () => withHook(async () => {
  fixtures.update.mockRejectedValueOnce({ status: 409, message: '已被更新' }).mockRejectedValueOnce(new Error('断网')).mockRejectedValueOnce({ status: 409, message: '被拒绝' })
  await act(async () => { await hook.submit(operation()) })
  expect(hook.pendingRecord).toBeNull(); expect(hook.error).toContain('已被更新'); expect(hook.conflict).toBe(true)
  await act(async () => { await hook.submit(operation()) })
  const key = hook.pendingRecord?.requestKey
  await act(async () => { await hook.retry() })
  expect(hook.pendingRecord?.requestKey).toBe(key)
}))
test('写入再次核对权限和原登录代次，禁止只读与跨账号重试', async () => withHook(async () => {
  const user = useAuthStore.getState().user!
  useAuthStore.setState({ user: { ...user, permissions: [PERMISSIONS.PRODUCT_VIEW] } })
  await act(async () => { await hook.submit(operation()) })
  expect(fixtures.update).not.toHaveBeenCalled()
  useAuthStore.setState({ user }); fixtures.update.mockRejectedValue(new Error('断网'))
  await act(async () => { await hook.submit(operation()) })
  useAuthStore.setState({ sessionGeneration: 11 })
  await act(async () => { await hook.retry() })
  expect(fixtures.update).toHaveBeenCalledTimes(1)
}))
test('删除重试保留原revision/资源id/键', async () => withHook(async () => {
  fixtures.remove.mockRejectedValueOnce(new Error('超时')).mockResolvedValueOnce({ ...result, deletedAt: '2026-10-02 00:00:00' })
  await act(async () => { await hook.submit({ kind: 'delete', id: 7, data: { revision: 3 } }) })
  expect(fixtures.remove).toHaveBeenCalledTimes(1)
  await act(async () => { await hook.retry() })
  expect(fixtures.remove).toHaveBeenCalledTimes(2)
  expect(fixtures.remove.mock.calls[1]).toEqual(fixtures.remove.mock.calls[0])
}))
test('当前端点已切换时禁止用原资料创建新请求，但原键仍可向原端点重试', async () => withHook(async () => {
  fixtures.defaults.baseURL = '/other'
  await act(async () => { await hook.submit(operation()) })
  expect(fixtures.update).not.toHaveBeenCalled()
  fixtures.defaults.baseURL = '/api'; fixtures.update.mockRejectedValueOnce(new Error('断网')).mockResolvedValueOnce(result)
  await act(async () => { await hook.submit(operation()) })
  fixtures.defaults.baseURL = '/other'
  await act(async () => { await hook.retry() })
  expect(fixtures.update.mock.calls[1][2].baseURL).toBe('/api')
  expect(hook.pendingRecord).toBeNull()
  expect(hook.error).toContain('原服务器已保存')
}))
test('不匹配资源的返回结果保持未知，删除缺失删除事实也不能称成功', async () => withHook(async () => {
  fixtures.remove.mockResolvedValue(result)
  await act(async () => { await hook.submit({ kind: 'delete', id: 7, data: { revision: 3 } }) })
  expect(hook.pendingRecord).not.toBeNull()
  expect(hook.error).toContain('结果未确认')
  fixtures.remove.mockResolvedValueOnce({ ...result, id: 8, deletedAt: '2026-10-02 09:00:00' })
  await act(async () => { await hook.retry() })
  expect(hook.pendingRecord?.operation).toMatchObject({ id: 7 })
}))
test('首次HTTP408冻结原body/key，changed submit被阻止，重试4xx仍未知', async () => withHook(async () => {
  fixtures.update.mockRejectedValueOnce({ status: 408, message: '请求超时' }).mockRejectedValueOnce({ status: 409, message: '重试被拒绝' })
  const op = operation()
  await act(async () => { await hook.submit(op) })
  const first = fixtures.update.mock.calls[0], key = hook.pendingRecord?.requestKey
  expect(hook.pendingRecord).not.toBeNull()
  op.data.referenceUnitPrice = 999
  await act(async () => { await hook.submit(op) })
  expect(fixtures.update).toHaveBeenCalledTimes(1)
  await act(async () => { await hook.retry() })
  expect(fixtures.update.mock.calls[1]).toEqual(first)
  expect(hook.pendingRecord?.requestKey).toBe(key)
  expect(first[1]).toEqual({ revision: 3, referenceUnitPrice: 100 })
}))
