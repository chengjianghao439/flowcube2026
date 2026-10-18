// @vitest-environment jsdom
// Real KitsPage, hooks, API, bounded collector and virtual table. The fetch
// transport is a deterministic offline fixture; unknown requests are rejected.
import { act } from 'react'
import { createRequire } from 'node:module'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import KitsPage from './index'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import apiClient, { setApiClientBaseURL } from '@/api/client'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true, roleId: 1 }) }))
vi.mock('./KitEditor', async () => {
  const { AppDialog } = await import('@/components/shared/AppDialog')
  return { default: ({ id, onClose }: { id: number; onClose: () => void }) => <AppDialog open dialogId="synthetic-kit-layout-only" title={`合成资料占位${id}`} onOpenChange={open => { if (!open) onClose() }}><button onClick={onClose}>返回列表</button></AppDialog> }
})

// Use the current backend's real pure validator: its strict maximum is100.
const listQuery = createRequire(import.meta.url)('../../../../backend/src/modules/kits/kits.contracts.js').listQuery
let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || url.pathname !== '/api/kits') { unexpected.push(`${method} ${url.pathname}`); return failure(403) }
  requests.push(url)
  if (!listQuery.safeParse(Object.fromEntries(url.searchParams)).success) return failure(400)
  return respond(url)
})
function batch(url: URL, total: number) {
  const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 200), from = (page - 1) * pageSize
  return new Response(JSON.stringify({ success: true, data: {
    list: Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => ({ id: from + i + 1, code: `KIT-SYN-${from + i + 1}`, name: `合成配件${from + i + 1}`, revision: 1, isActive: true, currentVersionId: from + i + 1, version: { versionNo: 1, components: [] } })),
    pagination: { page, pageSize, total },
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
function failure(status = 503) { return new Response(JSON.stringify({ success: false, code: 'SYNTHETIC_READ_REJECTED', message: '合成列表读取中断' }), { status, headers: { 'Content-Type': 'application/json' } }) }
const cache = () => query.getQueryCache().find({ queryKey: ['kits', 'list'], exact: false, type: 'active' })
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
function Location() { const location = useLocation(); return <output data-location>{location.pathname}{location.search}</output> }
async function mount(path = '/kits?keyword=APPLIED&page=3') { await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[path]}><Location /><div data-workspace-scroll style={{ height: 480, overflow: 'auto' }}><KitsPage /></div></MemoryRouter></QueryClientProvider>)) }
const button = (name: string, scope: ParentNode = document.body) => [...scope.querySelectorAll<HTMLButtonElement>('button,[role="menuitem"]')].find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name)!
async function click(name: string, scope: ParentNode = document.body) { const b = button(name, scope); expect(b).toBeTruthy(); expect(!!b.disabled).toBe(false); await act(async () => b.click()) }
async function change(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); requests.length = 0; unexpected.length = 0
  setApiClientBaseURL('http://kits-paging.fixture.invalid/api'); apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { const scroll = this.closest<HTMLElement>('[data-workspace-scroll]'), height = this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0, top = this === scroll ? 0 : -(scroll?.scrollTop || 0); return { height, width: 800, top, left: 0, bottom: top + height, right: 800, x: 0, y: top, toJSON() {} } })
  useAuthStore.setState({ token: 'synthetic-unit-only', sessionGeneration: 10, user: { id: 7, username: 'synthetic', realName: '合成用户', roleId: 1, roleName: '合成管理员', permissions: ['*'] } })
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); query.clear(); apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api'); vi.restoreAllMocks(); vi.unstubAllGlobals(); expect(unexpected).toEqual([]) })

test.each([201, 5000, 5001])('配件有界收集%i个匹配并明确完整性，不要求可见翻页', async total => {
  respond = url => batch(url, total); await mount(); await wait(() => expect(cache()?.state.status).toBe('success'))
  const data = cache()?.state.data as { list: unknown[]; truncated: boolean }
  expect(data.list).toHaveLength(Math.min(total, 5000)); expect(data.truncated).toBe(total > 5000)
  expect(requests).toHaveLength(Math.ceil(Math.min(total, 5000) / 100)); expect(requests[0].searchParams.get('page')).toBe('1')
  for (const url of requests) expect(url.searchParams.get('keyword')).toBe('APPLIED')
  expect(host.textContent).not.toMatch(/上一页|下一页|第 3 页/)
  const summary = host.querySelector('[role="status"]')?.textContent
  if (total > 5000) expect(summary).toMatch(/5,000.*5,001.*缩小查询范围/)
  else expect(summary).toBe(`共 ${total.toLocaleString()} 条`)
}, 20000)
test('配件续批失败拒绝部分结果，原条件可重试', async () => {
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 201)
  await mount('/kits?keyword=APPLIED'); await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(cache()?.state.data).toBeUndefined(); expect(host.textContent).not.toMatch(/KIT-SYN-|共 201 条|暂无成套配件/)
  respond = url => batch(url, 201); await click('重试'); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect((cache()?.state.data as { list: unknown[] }).list).toHaveLength(201)
})
test('配件缓存403隐藏旧行和旧计数，保留未应用搜索输入', async () => {
  respond = url => batch(url, 1); await mount('/kits?keyword=APPLIED'); await wait(() => expect(cache()?.state.status).toBe('success'))
  const input = host.querySelector<HTMLInputElement>('[aria-label="搜索成套配件"]')!; await change(input, '尚未应用')
  respond = () => failure(403); await act(async () => { await query.invalidateQueries({ queryKey: ['kits'] }) }); await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(host.textContent).not.toMatch(/KIT-SYN-|共 1 条/); expect(input.value).toBe('尚未应用')
  respond = url => batch(url, 1); await click('重试'); await wait(() => expect(cache()?.state.status).toBe('success'))
  for (const url of requests) expect(url.searchParams.get('keyword')).toBe('APPLIED')
})
test('配件查询只在显式提交后应用，URL清理旧页码', async () => {
  respond = url => batch(url, 201); await mount(); await wait(() => expect(cache()?.state.status).toBe('success'))
  const input = host.querySelector<HTMLInputElement>('[aria-label="搜索成套配件"]')!; await change(input, 'NEW'); await click('查询'); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(requests.slice(-2).every(url => url.searchParams.get('keyword') === 'NEW')).toBe(true)
  expect(host.querySelector('[data-location]')?.textContent).toBe('/kits?keyword=NEW')
})
test('配件加载中不宣称成功零条', async () => {
  let release!: (value: Response) => void; respond = () => new Promise(resolve => { release = resolve }); await mount('/kits')
  await wait(() => expect(release).toBeTypeOf('function'))
  expect(host.textContent).not.toContain('共 0 条')
  await act(async () => release(batch(requests.at(-1)!, 0))); await wait(() => expect(host.textContent).toContain('共 0 条'))
})
test('5000配件虚拟挂载有界且末行可达', async () => {
  respond = url => batch(url, 5000); await mount('/kits'); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) }); await wait(() => expect(host.textContent).toContain('KIT-SYN-5000'))
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
}, 20000)
test('配件虚拟行打开资料布局占位后保留原行并返回焦点', async () => {
  respond = url => batch(url, 5000); await mount('/kits'); await wait(() => expect(cache()?.state.status).toBe('success'))
  const source = button('维护', host); await act(async () => { source.focus(); source.click() }); await wait(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) }); await wait(() => expect(host.textContent).toContain('KIT-SYN-5000'))
  expect(source.isConnected).toBe(true)
  await click('返回列表', document.querySelector('[role="dialog"]')!); await wait(() => expect(document.activeElement).toBe(source))
}, 20000)

test.each([1, 2].flatMap(delayedPage => (['base', 'session', 'user'] as const).map(change => ({ delayedPage, change }))))('配件第$delayedPage批在途切换$change后拒绝旧结果且不续批', async ({ delayedPage, change }) => {
  let release!: (value: Response) => void
  respond = url => Number(url.searchParams.get('page')) === delayedPage ? new Promise(resolve => { release = resolve }) : batch(url, 201)
  await mount('/kits?keyword=APPLIED'); await wait(() => expect(release).toBeTypeOf('function'))
  const pending = requests.at(-1)!
  expect(requests).toHaveLength(delayedPage)
  await act(async () => {
    if (change === 'base') setApiClientBaseURL('http://kits-other.fixture.invalid/api')
    else if (change === 'session') useAuthStore.setState({ sessionGeneration: 11 })
    else useAuthStore.setState({ user: { ...useAuthStore.getState().user!, id: 8 } })
    release(batch(pending, 201))
  })
  await wait(() => expect(cache()?.state.fetchStatus).toBe('idle'))
  expect(requests, `${change}不得续发第${delayedPage + 1}批`).toHaveLength(delayedPage)
  expect(cache()?.state.status, change).toBe('error')
  expect(cache()?.state.data, change).toBeUndefined()
  expect(host.textContent).not.toMatch(/KIT-SYN-|共 201 条/)
  expect(requests.every(url => url.origin === 'http://kits-paging.fixture.invalid')).toBe(true)
})

test('配件列表同一账号会话正常刷新令牌仍可续批取齐', async () => {
  let release!: (value: Response) => void
  respond = url => Number(url.searchParams.get('page')) === 1 ? new Promise(resolve => { release = resolve }) : batch(url, 201)
  await mount('/kits'); await wait(() => expect(release).toBeTypeOf('function'))
  await act(async () => { useAuthStore.setState({ token: 'synthetic-refreshed-only' }); release(batch(requests[0], 201)) })
  await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(requests).toHaveLength(3)
  expect((cache()?.state.data as { list: unknown[] }).list).toHaveLength(201)
})
