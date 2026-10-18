// @vitest-environment jsdom
// Actual page, query dialog, API, QueryClient, bounded collector and virtual table.
// Closed synthetic GET transport and deterministic geometry; no network or writes.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './index'
import api, { getApiClientBaseURL, setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import KeepAliveSection from '@/components/shared/KeepAliveSection'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
const path = '/oplogs?keyword=APPLIED&module=products&startDate=2026-10-01&endDate=2026-10-15'
let host: HTMLDivElement, root: Root, cache: QueryClient
let total = 1, failedPage = 0, driftPage = 0, failStatus = 503, currentSearch = ''
let pendingSecond: Promise<Response> | null = null, pendingFirst: Promise<Response> | null = null
const requestSignals: (AbortSignal | undefined)[] = []
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = api.defaults.adapter, oldEnv = api.defaults.env, oldBase = getApiClientBaseURL()
const oldScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const oldScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
function row(id: number) { return { id, userId: 10, userName: `USER-SYN-${id}`, method: 'PUT', path: `/api/products/${id}`, module: 'products', statusCode: 200, ip: '127.0.0.1', createdAt: '2026-10-15T02:00:00Z', requestBody: `{"note":"BODY-SYN-${id}"}` } }
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { success: true, data } : { success: false, code: 'SYNTHETIC_LOG_READ_FAILURE', message: '合成日志连续读取失败' }), { status, headers: { 'Content-Type': 'application/json' } })
}
function batch(url: URL) {
  // OpLog controller passes numeric values; service normalizes page>=1 and clamps pageSize to 500.
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1), pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get('pageSize')) || 30)), from = (page - 1) * pageSize
  return response({ list: Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => row(from + i + 1)), pagination: { page, pageSize, total: page === driftPage ? total + 1 : total } })
}
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || url.pathname !== '/api/oplogs') { unexpected.push(`${method} ${url.pathname}`); throw Error('日志连续列表回归禁止未声明端点与写入') }
  requests.push(url)
  requestSignals.push(typeof input === 'object' && 'signal' in input ? input.signal : init?.signal ?? undefined)
  const page = Number(url.searchParams.get('page') || 1)
  if (page === 1 && pendingFirst) return pendingFirst
  if (page === failedPage) return response(null, failStatus)
  if (page === 2 && pendingSecond) return pendingSecond
  return batch(url)
})
const query = () => cache.getQueryCache().findAll({ queryKey: ['oplogs'], type: 'active' })[0]
const data = () => query()?.state.data as { list: { id: number }[]; pagination: { total: number }; truncated?: boolean } | undefined
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function wait(check: () => void) {
  for (let attempt = 0; attempt < 100; attempt++) { await flush(); try { check(); return } catch (error) { if (attempt === 99) throw error } }
}
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)
async function click(text: string, scope: ParentNode = host) {
  const node = button(text, scope); expect(node, text).toBeTruthy(); await act(async () => node!.click()); await flush()
}
async function input(node: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })) })
}
function LocationProbe() { currentSearch = useLocation().search; return null }
async function draw(active = true) {
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}>
    <LocationProbe /><KeepAliveSection active={active}><div data-workspace-scroll><Page /></div></KeepAliveSection>
  </MemoryRouter></QueryClientProvider>)); await flush()
}
async function loaded() { await wait(() => expect(query()?.state.status).toBe('success')) }
const actualRows = () => host.querySelectorAll('tbody tr:not([aria-hidden])')
const findRow = (id: number) => [...actualRows()].find(node => node.textContent?.includes(`USER-SYN-${id}`))!

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); total = 1; failedPage = 0; driftPage = 0; failStatus = 503; pendingSecond = null; pendingFirst = null; requestSignals.length = 0; requests.length = 0; unexpected.length = 0
  setApiClientBaseURL('http://logs-pages.test/api')
  useAuthStore.getState().login('oplogs-fixture', null, { id: 10, username: 'fixture', realName: '合成审计人员', roleId: 2, roleName: 'fixture', permissions: ['audit.log.view'] })
  useWorkspaceStore.setState({ tabs: [HOME_TAB, { key: '/oplogs', path, title: '操作日志', closable: true }], activeKey: '/oplogs' })
  api.defaults.adapter = 'fetch'; api.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn() })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-workspace-scroll]'), height = this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0, top = this === scroll ? 0 : -(scroll?.scrollTop || 0)
    return { height, width: 800, top, left: 0, bottom: top + height, right: 800, x: 0, y: top, toJSON() {} }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); cache.clear(); host.remove()
  api.defaults.adapter = oldAdapter; api.defaults.env = oldEnv; setApiClientBaseURL(oldBase)
  useAuthStore.setState({ user: null, token: null }); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); localStorage.clear()
  if (oldScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', oldScrollIntoView); else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  if (oldScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', oldScrollTo); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  vi.restoreAllMocks(); vi.unstubAllGlobals(); expect(unexpected).toEqual([])
})

test('201条按200批自动取齐，每批完整沿已应用URL与原隐藏规则，无可见分页', async () => {
  total = 201; await draw(); await loaded()
  expect(data()?.list).toHaveLength(201)
  expect(requests.map(url => [Number(url.searchParams.get('page')), Number(url.searchParams.get('pageSize'))])).toEqual([[1, 200], [2, 200]])
  for (const url of requests) expect(Object.fromEntries(url.searchParams)).toMatchObject({ keyword: 'APPLIED', module: 'products', startDate: '2026-10-01', endDate: '2026-10-15', hideDevelopment: '1', hidePrintPolling: '1' })
  expect(button('上一页')).toBeUndefined(); expect(button('下一页')).toBeUndefined()
  expect(host.textContent).not.toMatch(/第\s*\d+\s*\/\s*\d+\s*页/)
})

test.each([5000, 5001])('%i匹配严格5000上限与25批，截断反馈明确且虚拟挂载有界', async count => {
  total = count; await draw(); await loaded()
  expect(data()?.list).toHaveLength(5000); expect(requests).toHaveLength(25)
  expect(data()?.truncated).toBe(count === 5001)
  const text = host.textContent!.replace(/[,\s]/g, '')
  if (count === 5001) { expect(text).toContain('已加载5000'); expect(text).toContain('匹配5001'); expect(text).toContain('缩小查询范围') }
  else { expect(text).toContain('共5000'); expect(text).not.toContain('缩小查询范围') }
  expect(host.querySelector('[data-virtual-body]')).toBeTruthy(); expect(actualRows().length).toBeLessThan(50)
})

test.each(['failure', 'drift'])('续批%s拒残缺行与成功计数，重试从原查询首批重读', async kind => {
  total = 201; if (kind === 'failure') failedPage = 2; else driftPage = 2
  await draw(); await wait(() => expect(query()?.state.status).toBe('error'))
  expect(data()).toBeUndefined(); expect(actualRows()).toHaveLength(0)
  expect(host.querySelector('[role="status"]')).toBeNull(); expect(button('重试')).toBeTruthy()
  failedPage = 0; driftPage = 0; const before = requests.length
  await click('重试'); await loaded()
  expect(requests.slice(before).map(url => Number(url.searchParams.get('page')))).toEqual([1, 2])
  expect(data()?.list).toHaveLength(201)
})

test('末行可达，打开详情后原行滚出视口仍连接，关闭回原按钮且URL保留', async () => {
  total = 5000; await draw(); await loaded()
  const first = button('详情', findRow(1))!, scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!, search = currentSearch
  await act(async () => first.focus())
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  await wait(() => expect(findRow(5000)).toBeTruthy())
  expect(first.isConnected).toBe(true); expect(document.activeElement).toBe(first)
  const last = button('详情', findRow(5000))!
  await act(async () => { last.focus(); last.click() }); await flush()
  const modal = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(modal.textContent).toContain('USER-SYN-5000'); expect(modal.textContent).toContain('BODY-SYN-5000')
  await act(async () => { scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')) }); await flush()
  expect(last.isConnected).toBe(true)
  await click('关闭', modal)
  expect(document.activeElement).toBe(last); expect(currentSearch).toBe(search)
  expect(data()?.list).toHaveLength(5000); expect(requests).toHaveLength(25); expect(actualRows().length).toBeLessThan(50)
}, 15000)

test('后台完整读取/隐藏返回保未应用草稿，查询后URL和每批读取才切到新条件', async () => {
  total = 201; await draw(); await loaded(); const applied = currentSearch
  await click('查询')
  const draft = document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="请输入关键字…"]')!
  await input(draft, 'NOT-APPLIED')
  await act(async () => { await cache.refetchQueries({ queryKey: ['oplogs'] }) }); await flush()
  expect(draft.value).toBe('NOT-APPLIED'); expect(currentSearch).toBe(applied)
  await draw(false); expect(document.querySelector('[role="dialog"]')).toBeNull()
  await draw(true)
  const modal = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(modal.querySelector<HTMLInputElement>('[placeholder="请输入关键字…"]')?.value).toBe('NOT-APPLIED')
  const before = requests.length; await click('查询', modal); await loaded()
  expect(new URLSearchParams(currentSearch).get('keyword')).toBe('NOT-APPLIED')
  expect(requests.slice(before).map(url => url.searchParams.get('keyword'))).toEqual(['NOT-APPLIED', 'NOT-APPLIED'])
})

test.each([403, 500])('已打开详情遇到%i隐藏旧正文，原查询恢复保同ID上下文', async status => {
  await draw(); await loaded(); await click('详情')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('BODY-SYN-1')
  failedPage = 1; failStatus = status
  await act(async () => { await cache.refetchQueries({ queryKey: ['oplogs'] }) }); await flush()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.textContent).not.toContain('BODY-SYN-1'); expect(host.querySelector('[role="status"]')).toBeNull()
  failedPage = 0; await click('重试'); await loaded()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('BODY-SYN-1')
})

test.each(['server', 'session'])('第二批途中%s变化拒旧结果，不把后续页送去新上下文', async change => {
  let release!: (value: Response) => void
  total = 401; pendingSecond = new Promise(resolve => { release = resolve })
  await draw(); await wait(() => expect(requests.some(url => url.searchParams.get('page') === '2')).toBe(true))
  await act(async () => {
    if (change === 'server') setApiClientBaseURL('http://other-logs.test/api')
    else useAuthStore.setState(state => ({ sessionGeneration: state.sessionGeneration + 1 }))
  })
  await act(async () => release(response({ list: Array.from({ length: 200 }, (_, i) => row(201 + i)), pagination: { page: 2, pageSize: 200, total } })))
  await wait(() => expect(query()?.state.status).toBe('error'))
  expect(requests.some(url => url.searchParams.get('page') === '3')).toBe(false)
  expect(data()).toBeUndefined(); expect(actualRows()).toHaveLength(0)
})


test.each(['隐藏', '卸载'])('首批在途%s会取消订阅与信号，迟到完成不续批，恢复从首批重读', async mode => {
  let release!: (value: Response) => void
  total = 201; pendingFirst = new Promise(resolve => { release = resolve })
  await draw(); await wait(() => expect(requests).toHaveLength(1))
  const firstSignal = requestSignals[0]
  if (mode === '隐藏') await draw(false)
  else await act(async () => root.render(null))
  // The synthetic transport deliberately resolves late even when its signal is aborted.
  await act(async () => release(batch(requests[0])))
  await flush(); await flush()
  expect(requests.map(url => Number(url.searchParams.get('page')))).toEqual([1])
  expect(firstSignal?.aborted).toBe(true)
  expect(cache.getQueryCache().findAll({ queryKey: ['oplogs'] }).every(q => q.state.data === undefined)).toBe(true)
  pendingFirst = null; await draw(); await loaded()
  expect(requests.map(url => Number(url.searchParams.get('page')))).toEqual([1, 1, 2])
  expect(data()?.list).toHaveLength(201)
})
