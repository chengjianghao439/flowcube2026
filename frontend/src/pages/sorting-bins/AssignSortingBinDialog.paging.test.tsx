// @vitest-environment jsdom
// Actual dialog/query/paged API and collector, closed transport; no real allocation.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AssignSortingBinDialog from './AssignSortingBinDialog'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import type { PaginatedData } from '@/types'
import type { PendingSortingBinTask } from '@/api/warehouse-tasks'

let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
function failure(status = 500) { return json({ success: false, message: '合成分配候选读取失败', code: status === 403 ? 'WAREHOUSE_SCOPE_DENIED' : 'SYNTHETIC_READ_FAILURE' }, status) }
const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || url.pathname !== '/api/warehouse-tasks/sorting-bin-pending') { unexpected.push(`${method} ${url.pathname}`); return failure(403) }
  requests.push(url); return respond(url)
}
function row(id: number): PendingSortingBinTask { return { id, taskNo: `SYN-WT-${id}`, warehouseId: 8, warehouseName: '合成仓', customerName: '合成客户', status: 3, statusName: '待分拣', createdAt: '2026-10-15 08:00:00' } }
function batch(url: URL, total: number) {
  const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 20), start = (page - 1) * pageSize
  const taskId = Number(url.searchParams.get('taskId'))
  const list = taskId ? [row(taskId)] : Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, index) => row(start + index + 1))
  return json({ success: true, data: { list, pagination: { page, pageSize, total: taskId ? 1 : total } } })
}
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label) }
async function click(label: string) { const target = button(label); expect(target, label).toBeTruthy(); await act(async () => target!.click()) }
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
const cached = () => query.getQueryCache().find({ queryKey: ['sorting-bin-pending'], exact: false })
const data = () => cached()?.state.data as PaginatedData<PendingSortingBinTask> | undefined
async function draw(taskId?: number, open = true) { await act(async () => root.render(<QueryClientProvider client={query}><AssignSortingBinDialog open={open} warehouseId={8} taskId={taskId} onClose={() => {}} /></QueryClientProvider>)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear(); requests.length = 0; unexpected.length = 0
  setApiClientBaseURL('http://sorting-paging.fixture.invalid/api')
  useAuthStore.getState().login('synthetic', null, { id: 9, username: 'synthetic', realName: '合成员工', roleId: 2, roleName: '合成角色', permissions: [P.WAREHOUSE_TASK_ASSIGN] })
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 384 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-workspace-scroll]'), height = this.matches('[data-workspace-scroll]') ? 384 : this.tagName === 'TR' ? 48 : 0, top = this === scroll ? 0 : -(scroll?.scrollTop || 0)
    return { height, width: 600, top, left: 0, bottom: top + height, right: 600, x: 0, y: top, toJSON() {} }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  vi.restoreAllMocks(); vi.unstubAllGlobals(); expect(unexpected).toEqual([])
})

test('21个普通候选自动有界取齐，不要求员工翻页', async () => {
  respond = url => batch(url, 21); await draw(); await wait(() => expect(cached()?.state.status).toBe('success'))
  expect(data()?.list).toHaveLength(21)
  expect(document.body.textContent).toContain('SYN-WT-21')
  expect(document.body.textContent).not.toMatch(/上一页|下一页/)
  expect(requests.every(url => url.searchParams.get('warehouseId') === '8')).toBe(true)
})
test.each([5000, 5001])('真实取齐%i候选并披露完整性与有界挂载', async total => {
  respond = url => batch(url, total); await draw(); await wait(() => expect(cached()?.state.status).toBe('success'))
  expect(data()?.list).toHaveLength(5000); expect(data()?.truncated).toBe(total > 5000)
  expect(requests).toHaveLength(25)
  const text = [...document.querySelectorAll('[role="status"]')].map(node => node.textContent).join(' ')
  if (total > 5000) expect(/5,?000.*5,?001/.test(text) && /仅显示|未全部|未完整|截断/.test(text)).toBe(true)
  expect(document.body.textContent).not.toMatch(/上一页|下一页/)
  expect(document.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
}, 15000)
test('末条候选可滚动到达，已聚焦分配按钮仍保留且读取不自动分配', async () => {
  respond = url => batch(url, 5000); await draw(); await wait(() => expect(data()?.list).toHaveLength(5000))
  const first = button('补分配')!; await act(async () => first.focus())
  const scroll = document.querySelector<HTMLElement>('[role="dialog"] [data-workspace-scroll]')!
  expect(scroll).toBeTruthy()
  await act(async () => { scroll.scrollTop = 5000 * 48 - 384; scroll.dispatchEvent(new Event('scroll')) })
  await wait(() => expect(document.body.textContent).toContain('SYN-WT-5000'))
  expect(first.isConnected).toBe(true); expect(document.activeElement).toBe(first)
  expect(unexpected).toEqual([])
}, 15000)
test('续批500拒绝部分候选，原仓重试从第一批恢复', async () => {
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 201)
  await draw(); await wait(() => expect(cached()?.state.status).toBe('error'))
  expect(requests).toHaveLength(2); expect(data()).toBeUndefined()
  expect(button('补分配')).toBeUndefined(); expect(document.body.textContent).toContain('读取失败')
  respond = url => batch(url, 201); await click('重试'); await wait(() => expect(data()?.list).toHaveLength(201))
  expect(requests[2].searchParams.get('warehouseId')).toBe('8'); expect(requests[2].searchParams.get('page')).toBe('1')
})
test.each([500, 403])('缓存%i失败不提供旧候选分配动作', async status => {
  respond = url => batch(url, 2); await draw(); await wait(() => expect(button('补分配')).toBeTruthy())
  respond = () => failure(status)
  await act(async () => { await query.invalidateQueries({ queryKey: ['sorting-bin-pending'] }) })
  await wait(() => expect(cached()?.state.status).toBe('error'))
  expect(button('补分配')).toBeUndefined(); expect(document.body.textContent).not.toContain('SYN-WT-1')
})
test('精确taskId交接仍只查原仓单目标，成功空资格和重开刷新保留原合同', async () => {
  respond = url => batch(url, 5000); await draw(4999); await wait(() => expect(button('补分配')).toBeTruthy())
  expect(requests).toHaveLength(1)
  expect(Object.fromEntries(requests[0].searchParams)).toEqual({ warehouseId: '8', taskId: '4999', page: '1', pageSize: '20' })
  await draw(4999, false)
  let finish!: (response: Response) => void
  respond = () => new Promise(resolve => { finish = resolve }); await draw(4999)
  await wait(() => expect(finish).toBeTypeOf('function'))
  expect(button('补分配')?.disabled ?? true).toBe(true)
  await act(async () => finish(json({ success: true, data: { list: [], pagination: { page: 1, pageSize: 20, total: 0 } } })))
  await wait(() => expect(document.body.textContent).toContain('已刷新：该任务已不符合补分配条件'))
  expect(button('补分配')).toBeUndefined(); expect(unexpected).toEqual([])
})

test('普通候选续批固定原会话，首批响应后换会话不会拼入另一身份结果', async () => {
  respond = url => batch(url, 201)
  // A legal session change after the API interceptor accepted batch1, before
  // the component resumes its collector. No permission or real account write.
  const interceptor = apiClient.interceptors.response.use(response => {
    if (response.config.url === '/warehouse-tasks/sorting-bin-pending' && Number(response.config.params.page) === 1) {
      useAuthStore.setState(state => ({ sessionGeneration: state.sessionGeneration + 1 }))
    }
    return response
  })
  try {
    await draw(); await wait(() => expect(cached()?.state.status).toBe('error'))
    expect(data()).toBeUndefined(); expect(button('补分配')).toBeUndefined()
    expect(requests).toHaveLength(1)
  } finally { apiClient.interceptors.response.eject(interceptor) }
})

test('关闭时中止普通候选续批，重开从当前原仓第一批重新读取', async () => {
  let finish!: (response: Response) => void
  respond = () => new Promise(resolve => { finish = resolve })
  await draw(); await wait(() => expect(finish).toBeTypeOf('function'))
  await draw(undefined, false)
  await act(async () => finish(batch(requests[0], 201)))
  expect(requests).toHaveLength(1)
  respond = url => batch(url, 201)
  await draw(); await wait(() => expect(data()?.list).toHaveLength(201))
  expect(requests[1].searchParams.get('page')).toBe('1')
  expect(requests[1].searchParams.get('warehouseId')).toBe('8')
})
