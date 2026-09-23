// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { usePendingRequests, type PendingRequestRecord } from './usePendingRequests'
import type { User } from '@/types'
import { useCriticalPdaAction } from './useCriticalPdaAction'
vi.mock('./useNetworkStatus', () => ({ useNetworkStatus: () => 'online' }))
const receipt = vi.hoisted(() => ({ status: 'pending', fail: false, pause: null as Promise<void> | null }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: async () => { await receipt.pause; if (receipt.fail) throw new Error('Network Error'); return { status: receipt.status, data: {}, message: 'checked' } } }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const key = 'pda_pending_request_confirmations'
let root: Root | undefined
const values: ReturnType<typeof usePendingRequests>[] = []
const record = (action: string): PendingRequestRecord => ({ action, requestKey: action, label: action, createdAt: '2026-09-23T00:00:00Z' })
function Probe({ index }: { index: number }) { values[index] = usePendingRequests(); return null }
function mount() { root = createRoot(document.createElement('div')); act(() => root!.render(<><Probe index={0} /><Probe index={1} /></>)) }
function login(id: number) { act(() => useAuthStore.getState().login('test', null, { id } as User)) }
beforeEach(() => { localStorage.clear(); receipt.status = 'pending'; receipt.fail = false; receipt.pause = null; login(1) })
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.restoreAllMocks(); act(() => useAuthStore.getState().logout()) })
test('两个实例添加、替换、移除及卸载重挂共享同一份 pending', () => {
  mount()
  act(() => { values[0].addPending(record('a')); values[1].addPending(record('b')) })
  expect(values[0].records.map(r => r.action)).toEqual(['a', 'b'])
  expect(values[1].pendingCount).toBe(2)
  act(() => values[0].addPending({ ...record('b'), requestKey: 'replacement' }))
  expect(values[1].records.find(r => r.action === 'b')?.requestKey).toBe('replacement')
  expect(values[1].pendingCount).toBe(2)
  act(() => values[1].removePending('a'))
  expect(values[0].records.map(r => r.action)).toEqual(['b'])
  act(() => root!.unmount()); mount()
  expect(values[0].records.map(r => r.action)).toEqual(['b'])
})
test('读取异常不白屏，写入异常不丢内存 pending，重挂仍阻断', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('read denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(mount).not.toThrow()
  act(() => values[0].addPending(record('a')))
  expect(values[1].pendingCount).toBe(1)
  act(() => root!.unmount()); mount()
  expect(values[0].pendingCount).toBe(1)
})
test('有归属记录切换用户和退出后不显示旧用户记录或接受旧回调', () => {
  localStorage.setItem(key, JSON.stringify({ version: 2, userId: 1, records: [record('owned')] }))
  mount(); expect(values[1].pendingCount).toBe(1)
  const staleAdd = values[0].addPending
  login(2)
  expect(values[0].pendingCount).toBe(0)
  act(() => staleAdd(record('stale')))
  expect(values[0].pendingCount).toBe(0)
  act(() => values[0].addPending(record('current')))
  act(() => useAuthStore.getState().logout())
  expect(values[0].pendingCount).toBe(0)
  expect(localStorage.getItem(key)).toBeNull()
})
test('登出存储删除失败后同一用户重新登录也不复活上一会话', () => {
  mount(); act(() => values[0].addPending(record('old')))
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
  act(() => useAuthStore.getState().logout()); login(1)
  expect(values[0].pendingCount).toBe(0)
})

test('关键操作遇到存储写失败与网络超时，仍保留 pending 并禁止重复执行', async () => {
  let critical!: ReturnType<typeof useCriticalPdaAction>
  function CriticalProbe() { critical = useCriticalPdaAction<unknown>({ action: 'task.1', label: '测试操作' }); return null }
  root = createRoot(document.createElement('div'))
  act(() => root!.render(<><CriticalProbe /><Probe index={0} /></>))
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  const executor = vi.fn().mockRejectedValue(new Error('Network Error'))
  await act(async () => { expect((await critical.run(executor)).kind).toBe('pending') })
  expect(critical.submitBlocked).toBe(true)
  expect(values[0].pendingCount).toBe(1)
  await expect(critical.run(executor)).rejects.toThrow('结果待确认')
  expect(executor).toHaveBeenCalledOnce()
})


test('无归属旧数组只呈现隔离占位，换号写新记录与退出不能覆盖，迁移失败保留原 key', async () => {
  const legacy = [{ ...record('legacy-sensitive'), label: '客户名称', metadata: { customer: '客户私密' } }]
  localStorage.setItem(key, JSON.stringify(legacy))
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  mount()
  expect(values[0].records[0]).toMatchObject({ action: 'legacy-sensitive', requestKey: 'legacy-sensitive', unverifiedOwner: true })
  expect(JSON.stringify(values[0].records)).not.toContain('客户')
  expect(localStorage.getItem(key)).toBe(JSON.stringify(legacy))
  const authSet = vi.mocked(Storage.prototype.setItem); authSet.mockRestore()
  login(2)
  act(() => values[0].addPending(record('new-user')))
  expect(values[0].records.some(r => r.action === 'legacy-sensitive')).toBe(true)
  expect(JSON.stringify(values[0].records)).not.toContain('客户')
  act(() => values[0].removePending('legacy-sensitive'))
  expect(values[0].records.some(r => r.action === 'legacy-sensitive')).toBe(true)
  act(() => values[0].clearAll())
  expect(values[0].records.some(r => r.action === 'legacy-sensitive')).toBe(true)
})
test('隔离旧记录查无回执或请求异常时不走业务状态认领，不清除且持续阻断', async () => {
  localStorage.setItem(key, JSON.stringify([{ ...record('legacy-unowned'), metadata: { secret: 'private' } }]))
  receipt.status = 'not_found'
  let critical!: ReturnType<typeof useCriticalPdaAction>
  const resolveServerState = vi.fn(async () => ({ effective: true as const, data: {} }))
  const onConfirmed = vi.fn()
  function CriticalProbe() { critical = useCriticalPdaAction<unknown>({ action: 'legacy-unowned', label: '当前操作', resolveServerState, onConfirmed }); return null }
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(<CriticalProbe />))
  expect(critical.submitBlocked).toBe(true)
  expect(resolveServerState).not.toHaveBeenCalled(); expect(onConfirmed).not.toHaveBeenCalled()
  receipt.fail = true
  await act(async () => { await critical.confirmPending() })
  expect(resolveServerState).not.toHaveBeenCalled(); expect(critical.submitBlocked).toBe(true)
  receipt.fail = false; receipt.status = 'success'
  await act(async () => { await critical.confirmPending() })
  expect(critical.submitBlocked).toBe(false); expect(onConfirmed).toHaveBeenCalledOnce()
})
test.each(['failed', 'manual'])('隔离旧记录仅凭当前账号失败回执或用户明确核对清除：%s', async outcome => {
  localStorage.setItem(key, JSON.stringify([record('legacy-clear')]))
  receipt.status = 'not_found'
  let critical!: ReturnType<typeof useCriticalPdaAction>
  function CriticalProbe() { critical = useCriticalPdaAction<unknown>({ action: 'legacy-clear', label: '当前操作' }); return null }
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(<CriticalProbe />))
  expect(critical.submitBlocked).toBe(true)
  if (outcome === 'manual') act(() => critical.clearPending())
  else { receipt.status = 'failed'; await act(async () => { await critical.confirmPending() }) }
  expect(critical.submitBlocked).toBe(false)
  act(() => root!.unmount()); mount()
  expect(values[0].records.some(r => r.action === 'legacy-clear')).toBe(false)
})

test('旧账号归属核对迟到成功不能认领或清理新账号看到的隔离记录', async () => {
  localStorage.setItem(key, JSON.stringify([record('legacy-late')]))
  let release!: () => void
  receipt.pause = new Promise<void>(resolve => { release = resolve }); receipt.status = 'success'
  let critical!: ReturnType<typeof useCriticalPdaAction>
  const onConfirmed = vi.fn()
  function CriticalProbe() { critical = useCriticalPdaAction<unknown>({ action: 'legacy-late', label: '当前操作', onConfirmed }); return null }
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(<CriticalProbe />))
  login(2)
  await act(async () => { release(); await Promise.resolve() })
  expect(onConfirmed).not.toHaveBeenCalled()
  expect(critical.pendingRecord?.unverifiedOwner).toBe(true)
  expect(critical.submitBlocked).toBe(true)
})

test.each(['same-hook', 'two-hooks'])('同一事件 tick 同 action 同步占位，仅一个执行器运行：%s', async mode => {
  const critical: ReturnType<typeof useCriticalPdaAction<unknown>>[] = []
  function CriticalProbe({ index }: { index: number }) { critical[index] = useCriticalPdaAction<unknown>({ action: 'same-tick', label: '测试操作' }); return null }
  root = createRoot(document.createElement('div'))
  act(() => root!.render(<><CriticalProbe index={0} /><CriticalProbe index={1} /></>))
  let release!: () => void
  const paused = new Promise<void>(resolve => { release = resolve })
  const executor = vi.fn(async () => { await paused; return {} })
  let first!: ReturnType<typeof critical[0]['run']>
  let second!: Promise<unknown>
  // 两次调用之间没有 await，也不让 React 提交新 render。
  await act(async () => {
    first = critical[0].run(executor)
    second = critical[mode === 'same-hook' ? 0 : 1].run(executor).catch(error => error)
  })
  expect(executor).toHaveBeenCalledTimes(1)
  expect(await second).toBeInstanceOf(Error)
  expect((await second as Error).message).toContain('结果待确认')
  await act(async () => { release(); await first })
})
