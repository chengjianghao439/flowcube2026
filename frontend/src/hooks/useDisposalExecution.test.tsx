// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import client, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { useDisposalExecution } from './useDisposalExecution'
import { DISPOSAL_EXECUTION_STORAGE } from '@/lib/disposalRecovery'
let mode = '500', query = 'not_found', active = true, id = 11
let releaseQuery: (() => void) | undefined
let releasePost: (() => void) | undefined
const posts: InternalAxiosRequestConfig[] = [], gets: InternalAxiosRequestConfig[] = []
const oldAdapter = client.defaults.adapter
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); posts.length = 0; gets.length = 0; mode = '500'; query = 'not_found'; active = true; id = 11; setApiClientBaseURL('/a'); useAuthStore.getState().login('offline', null, { id: 9, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 2, permissions: [P.INVENTORY_DISPOSAL_EXECUTE] }); client.defaults.adapter = (async config => {
  const data = (value: unknown) => ({ data: { success: true, data: value }, status: 200, statusText: 'OK', headers: {}, config })
  if (config.method === 'post') { posts.push(config); const resource = Number(config.url?.split('/')[2]); if (mode === 'late-error') { await new Promise<void>(resolve => { releasePost = resolve }); throw Error('old POST rejected') }; if (mode === 'late') { await new Promise<void>(resolve => { releasePost = resolve }); return data({ id: resource, disposalNo: `DP${resource}`, disposedValue: 10 }) }; if (mode === 'ack') return data({ id: resource, disposalNo: `DP${resource}`, disposedValue: 10 }); if (mode === 'wrong') return data({ id: 12, disposalNo: 'DP12', disposedValue: 10 }); throw new AxiosError('unknown', undefined, config, undefined, { status: mode === '400' ? 400 : 500, statusText: 'error', headers: {}, config, data: { success: false, data: mode === '400' ? { disposalNotExecuted: true } : null } }) }
  if (config.url?.startsWith('/system/request-status/')) { gets.push(config); if (query === 'late-error') { await new Promise<void>(resolve => { releaseQuery = resolve }); throw Error('old query rejected') }; if (query === 'late') await new Promise<void>(resolve => { releaseQuery = resolve }); if (query === 'error') throw Error('query offline'); return data(query === 'success' ? { status: 'success', resourceType: 'inventory_disposal', resourceId: 11, data: { id: 11, disposalNo: 'DP11', disposedValue: 10 } } : query === 'wrong' ? { status: 'success', resourceType: 'sale_order', resourceId: 11, data: { id: 11, disposalNo: 'DP11', disposedValue: 10 } } : { status: query, data: null }) }
  throw Error(`Forbidden adapter path ${config.url}`)
}) satisfies AxiosAdapter })
afterEach(() => { client.defaults.adapter = oldAdapter; vi.restoreAllMocks(); localStorage.clear() })
async function harness(run: (current: () => ReturnType<typeof useDisposalExecution>[], draw: () => Promise<void>) => Promise<void>) {
  const host = document.createElement('div'), root = createRoot(host), cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } }), values: ReturnType<typeof useDisposalExecution>[] = []
  function View({ index }: { index: number }) { values[index] = useDisposalExecution(id, active); return null }
  async function draw() { await act(async () => root.render(<QueryClientProvider client={cache}><View index={0} /><View index={1} /></QueryClientProvider>)) }
  await draw(); try { await run(() => values, draw) } finally { await act(async () => root.unmount()); cache.clear() }
}
it('5xx持久冻结，两个详情共享占位，主动not_found原键原body重试', async () => { await harness(async h => { await act(async () => { await h()[0].execute() }); expect(h()[1].blocked).toBe(true); await act(async () => { await h()[1].execute() }); expect(posts).toHaveLength(1); const record = JSON.parse(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)!)[0]; expect(record.body).toEqual({}); expect(JSON.stringify(record)).not.toContain('offline'); await act(async () => { await h()[0].queryOriginal() }); mode = 'ack'; await act(async () => { await h()[0].retry() }); expect(posts).toHaveLength(2); expect(posts[1].data).toBe(posts[0].data); expect(posts[1].headers['X-Request-Key']).toBe(posts[0].headers['X-Request-Key']); expect(h()[0].result?.id).toBe(11) }) })
it('首发明确rollback可以退出；unknown重试同4xx仍保原记录', async () => { await harness(async h => { mode = '400'; await act(async () => { await h()[0].execute() }); expect(h()[0].blocked).toBe(false); mode = '500'; await act(async () => { await h()[0].execute() }); await act(async () => { await h()[0].queryOriginal() }); mode = '400'; await act(async () => { await h()[0].retry() }); expect(h()[0].blocked).toBe(true); expect(JSON.parse(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)!)).toHaveLength(1) }) })
it.each(['error', 'pending', 'wrong'])('查询%s保持记录，没有自动POST或成功误认', async answer => { await harness(async h => { await act(async () => { await h()[0].execute() }); query = answer; await act(async () => { await h()[0].queryOriginal() }); expect(h()[0].blocked).toBe(true); expect(posts).toHaveLength(1); expect(h()[0].result).toBeNull() }) })
it('存储失败先挡POST；成功后清理失败仍挡第二次POST', async () => { await harness(async h => { const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('storage unavailable') }); await act(async () => { await h()[0].execute() }); expect(posts).toHaveLength(0); spy.mockRestore(); mode = 'ack'; const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw Error('cannot clean') }); await act(async () => { await h()[0].execute() }); await act(async () => { await h()[1].execute() }); expect(posts).toHaveLength(1); expect(h()[0].blocked).toBe(true); remove.mockRestore() }) })
it('原portal回调隐藏后不发POST；ABA后原query结果不写新上下文', async () => { await harness(async (h, draw) => { const old = h()[0].execute; active = false; await draw(); await act(async () => { await old() }); expect(posts).toHaveLength(0); active = true; await draw(); await act(async () => { await h()[0].execute() }); query = 'late'; let pending: Promise<unknown>; await act(async () => { pending = h()[0].queryOriginal(); await new Promise(r => setTimeout(r, 5)) }); await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); query = 'success'; releaseQuery!(); await pending! }); expect(h()[0].result).toBeNull(); expect(posts).toHaveLength(1) }) })
it('撤执行权仍可查询本人原结果，不能retry', async () => { await harness(async h => { await act(async () => { await h()[0].execute() }); await act(async () => useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [] } }))); await act(async () => { await h()[0].queryOriginal() }); expect(gets).toHaveLength(1); expect(h()[0].canRetry).toBe(false); await act(async () => { await h()[0].retry() }); expect(posts).toHaveLength(1) }) })

it('retry只在主动查到fresh not_found后开放；隐藏再显示使原proof和迟到query失效', async () => { await harness(async (h, draw) => { await act(async () => { await h()[0].execute() }); expect(h()[0].canRetry).toBe(false); await act(async () => { await h()[0].queryOriginal() }); expect(h()[0].canRetry).toBe(true); active = false; await draw(); active = true; await draw(); expect(h()[0].canRetry).toBe(false); mode = 'ack'; await act(async () => { await h()[0].retry() }); expect(posts).toHaveLength(1) }) })
it('成功清理后另一个旧详情实例也不能另建新键POST', async () => { await harness(async h => { mode = 'ack'; await act(async () => { await h()[0].execute() }); await act(async () => { await h()[1].execute() }); expect(posts).toHaveLength(1); expect(h()[1].blocked).toBe(true) }) })
it.each(['expired', 'future', 'missingBody'])('%s原记录在仍有EXECUTE时也只能查询，不能原键重试', async kind => { await harness(async (h, draw) => {
  await act(async () => { await h()[0].execute() }); const record = JSON.parse(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)!)[0]
  if (kind === 'missingBody') delete record.body
  else record.createdAt = Date.now() + (kind === 'expired' ? -8 : 1) * 86400000
  localStorage.setItem(DISPOSAL_EXECUTION_STORAGE, JSON.stringify([record])); await draw()
  await act(async () => { await h()[0].queryOriginal() }); expect(h()[0].canRetry).toBe(false)
  await act(async () => { await h()[0].retry() }); expect(posts).toHaveLength(1); expect(gets).toHaveLength(1); expect(h()[0].blocked).toBe(true)
}) })
it('A仍在途切B，B只按自己占位执行；晚A不能清B或替换B成功，A原记录仍保留', async () => { await harness(async (h, draw) => {
  mode = 'late'; let pending: Promise<unknown>; await act(async () => { pending = h()[0].execute(); await new Promise(resolve => setTimeout(resolve, 5)) })
  try {
    id = 12; mode = 'ack'; await draw(); expect(h()[0].blocked).toBe(false)
    await act(async () => { await h()[0].execute() }); expect(h()[0].result?.id).toBe(12)
    await act(async () => { releasePost!(); await pending! }); expect(h()[0].result?.id).toBe(12)
    expect(JSON.parse(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)!).map((record: { id: number }) => record.id)).toEqual([11])
  } finally { await act(async () => { releasePost?.(); await pending! }) }
}) })
it('隐藏再显示之前发出的查询迟到success不应用，仍保原记录供再次核对', async () => { await harness(async (h, draw) => {
  await act(async () => { await h()[0].execute() }); const original = localStorage.getItem(DISPOSAL_EXECUTION_STORAGE); query = 'late'; let pending: Promise<unknown>
  await act(async () => { pending = h()[0].queryOriginal(); await new Promise(resolve => setTimeout(resolve, 5)) })
  active = false; await draw(); active = true; await draw(); query = 'success'
  await act(async () => { releaseQuery!(); await pending! }); expect(h()[0].result).toBeNull(); expect(h()[0].blocked).toBe(true); expect(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)).toBe(original)
}) })
it('详情实例先A成功再切B，旧成功/错误不显示或挡B；A未知不挡B首发明确未执行出口', async () => { await harness(async (h, draw) => {
  mode = 'ack'; await act(async () => { await h()[0].execute() }); id = 12; await draw()
  expect(h()[0].result).toBeNull(); expect(h()[0].error).toBe(''); expect(h()[0].blocked).toBe(false)
  await act(async () => { await h()[0].execute() }); expect(posts).toHaveLength(2); expect(h()[0].result?.id).toBe(12)
  id = 13; await draw(); mode = '500'; await act(async () => { await h()[0].execute() }); id = 14; await draw(); mode = '400'
  await act(async () => { await h()[0].execute() }); expect(h()[0].blocked).toBe(false)
  const retained = JSON.parse(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)!); expect(retained.map((record: { id: number }) => record.id)).toEqual([13])
}) })

function changeOwner(change: string) {
  if (change === 'serverABA') { setApiClientBaseURL('/b'); setApiClientBaseURL('/a') }
  if (change === 'actorABA') { const original = useAuthStore.getState().user!; useAuthStore.setState({ user: { ...original, id: 10 } }); useAuthStore.setState({ user: original }) }
  if (change === 'withdraw') useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [] } }))
}
it.each(['serverABA', 'actorABA', 'withdraw'])('迟到POST拒绝在%s后不写当前错误，保留原请求', async change => {
  await harness(async h => {
    mode = 'late-error'; let pending: Promise<unknown> | undefined
    await act(async () => { pending = h()[0].execute(); await new Promise(resolve => setTimeout(resolve, 5)) })
    try {
      const original = localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)
      await act(async () => changeOwner(change))
      await act(async () => { releasePost!(); await pending })
      expect(h()[0].error).toBe(''); expect(h()[0].result).toBeNull()
      expect(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)).toBe(original)
    } finally { await act(async () => { releasePost?.(); await pending }) }
  })
})
it.each(['serverABA', 'actorABA', 'withdraw'])('迟到查询拒绝在%s后不写当前错误，新鲜本人查询仍可用', async change => {
  await harness(async h => {
    await act(async () => { await h()[0].execute() }); query = 'late-error'; let pending: Promise<unknown> | undefined
    await act(async () => { pending = h()[0].queryOriginal(); await new Promise(resolve => setTimeout(resolve, 5)) })
    try {
      const original = localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)
      await act(async () => changeOwner(change))
      await act(async () => { releaseQuery!(); await pending })
      expect(h()[0].error).toBe(''); expect(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)).toBe(original)
      query = 'error'; await act(async () => { await h()[0].queryOriginal() })
      expect(h()[0].error).toBe('操作失败，请稍后重试'); expect(gets).toHaveLength(2); expect(posts).toHaveLength(1)
    } finally { await act(async () => { releaseQuery?.(); await pending }) }
  })
})
it('成功记录清理失败前归属变化，不把原清理错误写入新上下文', async () => {
  await harness(async h => {
    mode = 'ack'
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { changeOwner('serverABA'); throw Error('cannot clean original') })
    try {
      await act(async () => { await h()[0].execute() })
      expect(h()[0].error).toBe(''); expect(h()[0].result).toBeNull()
      expect(JSON.parse(localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)!)[0].phase).toBe('confirmed')
      expect(posts).toHaveLength(1)
    } finally { remove.mockRestore() }
  })
})
