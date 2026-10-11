// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ auth: { user: { id: 4 }, token: 'synthetic', sessionGeneration: 1 }, client: { defaults: { baseURL: '/original' } } }))
vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => state.auth } }))
vi.mock('@/api/client', () => ({ default: state.client }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: vi.fn().mockResolvedValue({ status: 'not_found' }) }))
import { submitReprintIntent, getReprintIntent } from './printReprintIntent'
beforeEach(() => { sessionStorage.clear(); localStorage.clear();
  let tail: Promise<unknown> = Promise.resolve()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_key: string, callback: () => Promise<unknown>) => { const work = tail.then(callback); tail = work.catch(() => {}); return work } } }); state.auth = { user: { id: 4 }, token: 'synthetic', sessionGeneration: 1 }; state.client.defaults.baseURL = '/original' })
const body = { mode: 'task' }
test('丢失响应保持原键，成功后主动再补生成新键', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ taskId: 9 })
  await expect(submitReprintIntent('inbound:9', body, send)).rejects.toThrow('response lost')
  await submitReprintIntent('inbound:9', body, send)
  expect(send.mock.calls[0][0]).toBe(send.mock.calls[1][0])
  await submitReprintIntent('inbound:9', body, send, () => true, { newIntent: true, expectedKey: getReprintIntent('inbound:9')?.key })
  expect(send.mock.calls[2][0]).not.toBe(send.mock.calls[0][0])
  expect(send.mock.calls[1][1]).toMatchObject({ baseURL: '/original', _erpApiFallbackTried: true, _authSessionGeneration: 1 })
})
test('未知结果不允许改正文或4xx后换键', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('lost')).mockRejectedValueOnce(new Error('403')).mockResolvedValue({ taskId: 9 })
  await expect(submitReprintIntent('inbound:9', body, send)).rejects.toThrow('lost')
  await expect(submitReprintIntent('inbound:9', { mode: 'barcode', barcode: 'other' }, send)).rejects.toThrow('原补打结果尚未确认')
  expect(send).toHaveBeenCalledTimes(1)
  await expect(submitReprintIntent('inbound:9', body, send)).rejects.toThrow('403')
  await submitReprintIntent('inbound:9', body, send)
  expect(new Set(send.mock.calls.map(c => c[0])).size).toBe(1)
})
test('两次并发点击只发一次POST并共享结果', async () => {
  let resolve!: (value: { taskId: number }) => void
  const send = vi.fn((_key: string) => new Promise<{ taskId: number }>(r => { resolve = r }))
  const a = submitReprintIntent('inbound:9', body, send), b = submitReprintIntent('inbound:9', body, send)
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1)); resolve({ taskId: 9 })
  expect(await a).toEqual(await b)
})
test('存储失败拒绝写入；错身份回执保留原键', async () => {
  const send = vi.fn().mockResolvedValue({ taskId: 10 }), storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('storage unavailable') })
  await expect(submitReprintIntent('inbound:9', body, send)).rejects.toThrow('storage unavailable'); expect(send).not.toHaveBeenCalled(); storage.mockRestore()
  await expect(submitReprintIntent('inbound:9', body, send, (r: { taskId: number }) => r.taskId === 9)).rejects.toThrow('无法确认')
  send.mockResolvedValue({ taskId: 9 }); await submitReprintIntent('inbound:9', body, send, (r: { taskId: number }) => r.taskId === 9)
  expect(send.mock.calls[0][0]).toBe(send.mock.calls[1][0])
})
test('账号或服务器变化后迟到回执不清除原意图', async () => {
  let resolve!: (value: { taskId: number }) => void
  const send = vi.fn((_key: string) => new Promise<{ taskId: number }>(r => { resolve = r }))
  const a = submitReprintIntent('inbound:9', body, send)
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1)); state.auth.sessionGeneration = 2; state.client.defaults.baseURL = '/other'; resolve({ taskId: 9 }); expect(await a).toBeNull()
  state.client.defaults.baseURL = '/original'
  const retry = vi.fn().mockResolvedValue({ taskId: 9 }); await submitReprintIntent('inbound:9', body, retry)
  expect(retry.mock.calls[0][0]).toBe(send.mock.calls[0][0])
})
test('页面重建仍从原会话存储恢复原键', async () => {
  const first = vi.fn().mockRejectedValue(new Error('lost'))
  await expect(submitReprintIntent('inbound:9', body, first)).rejects.toThrow('lost')
  vi.resetModules()
  const fresh = await import('./printReprintIntent'), retry = vi.fn().mockResolvedValue({ taskId: 9 })
  await fresh.submitReprintIntent('inbound:9', body, retry)
  expect(retry.mock.calls[0][0]).toBe(first.mock.calls[0][0])
})

// 独立复验追加：真实关页会清空会话存储，但未知意图必须继续存在。
test('关页重开仍保留原未知键，不产生第二补打', async () => {
  localStorage.clear()
  const first = vi.fn().mockRejectedValue(new Error('lost'))
  await expect(submitReprintIntent('barcode:inbound:31', body, first)).rejects.toThrow('lost')
  sessionStorage.clear(); vi.resetModules()
  const fresh = await import('./printReprintIntent'), retry = vi.fn().mockResolvedValue({ taskId: 31 })
  await fresh.submitReprintIntent('barcode:inbound:31', body, retry)
  expect(retry.mock.calls[0][0]).toBe(first.mock.calls[0][0])
})
test('独立模块上下文并发，成功后第二上下文仍消费原结果', async () => {
  localStorage.clear()
  const first = vi.fn().mockResolvedValue({ taskId: 32 })
  await submitReprintIntent('barcode:inbound:32', body, first)
  sessionStorage.clear(); vi.resetModules()
  const fresh = await import('./printReprintIntent'), second = vi.fn().mockResolvedValue({ taskId: 32 })
  await fresh.submitReprintIntent('barcode:inbound:32', body, second)
  expect(second).not.toHaveBeenCalled()
})

test('过期未知意图查询不到回执，绝不发送旧意图POST', async () => {
  const send = vi.fn().mockRejectedValue(new Error('lost'))
  await expect(submitReprintIntent('barcode:inbound:41', body, send)).rejects.toThrow('lost')
  const storage = Object.keys(localStorage).find(k => k.includes('barcode:inbound:41'))!
  const record = JSON.parse(localStorage.getItem(storage)!); record.createdAt = Date.now() - 8 * 86400000
  localStorage.setItem(storage, JSON.stringify(record)); send.mockClear()
  await expect(submitReprintIntent('barcode:inbound:41', body, send)).rejects.toThrow('已过期')
  expect(send).not.toHaveBeenCalled()
})
test('不支持跨页面锁时拒绝POST，不退回不安全提交', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  const send = vi.fn()
  await expect(submitReprintIntent('barcode:inbound:42', body, send)).rejects.toThrow('不能安全协调')
  expect(send).not.toHaveBeenCalled()
})
