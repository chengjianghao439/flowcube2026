// @vitest-environment jsdom
// Real UsersPage, hooks, API, bounded collector and virtual table. The fetch
// transport is a deterministic offline fixture; unknown requests are rejected.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import UsersPage from './index'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true, roleId: 1 }) }))
vi.mock('./components/UserFormDialog', () => ({ default: () => null }))
vi.mock('./components/WarehouseScopeDialog', () => ({ default: () => null }))

let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || url.pathname !== '/api/users') { unexpected.push(`${method} ${url.pathname}`); return failure(403) }
  requests.push(url); return respond(url)
})
function batch(url: URL, total: number) {
  const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 200), from = (page - 1) * pageSize
  return new Response(JSON.stringify({ success: true, data: {
    list: Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => ({ id: from + i + 1, username: `USER-SYN-${from + i + 1}`, realName: `合成用户${from + i + 1}`, roleId: 2, roleName: '合成角色', isActive: true })),
    pagination: { page, pageSize, total },
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
function failure(status = 503) { return new Response(JSON.stringify({ success: false, code: 'SYNTHETIC_READ_REJECTED', message: '合成列表读取中断' }), { status, headers: { 'Content-Type': 'application/json' } }) }
const cache = () => query.getQueryCache().find({ queryKey: ['users'], exact: false, type: 'active' })
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
async function mount(active = true) { await act(async () => root.render(<QueryClientProvider client={query}><SectionVisibilityContext.Provider value={active}><div data-workspace-scroll style={{ height: 480, overflow: 'auto', display: active ? undefined : 'none' }}><UsersPage /></div></SectionVisibilityContext.Provider></QueryClientProvider>)) }
const button = (name: string, scope: ParentNode = document.body) => [...scope.querySelectorAll<HTMLButtonElement>('button,[role="menuitem"]')].find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name)!
async function click(name: string, scope: ParentNode = document.body) { const b = button(name, scope); expect(b).toBeTruthy(); expect(!!b.disabled).toBe(false); await act(async () => b.click()) }
async function change(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); requests.length = 0; unexpected.length = 0
  useAuthStore.setState({ token: 'synthetic-unit-only', sessionGeneration: 10, user: { id: 7, username: 'synthetic', realName: '合成用户', roleId: 1, roleName: '合成管理员', permissions: ['*'] } })
  setApiClientBaseURL('http://users-paging.fixture.invalid/api'); apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { const scroll = this.closest<HTMLElement>('[data-workspace-scroll]'), height = this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0, top = this === scroll ? 0 : -(scroll?.scrollTop || 0); return { height, width: 800, top, left: 0, bottom: top + height, right: 800, x: 0, y: top, toJSON() {} } })
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); query.clear(); apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api'); vi.restoreAllMocks(); vi.unstubAllGlobals(); expect(unexpected).toEqual([]) })

test.each([201, 5000, 5001])('有界收集%i个匹配并明确完整性，不要求用户翻页', async total => {
  respond = url => batch(url, total); await mount(); await wait(() => expect(cache()?.state.status).toBe('success'))
  const data = cache()?.state.data as { list: unknown[]; truncated: boolean }
  expect(data.list).toHaveLength(Math.min(total, 5000)); expect(data.truncated).toBe(total > 5000)
  expect(requests).toHaveLength(Math.ceil(Math.min(total, 5000) / 200))
  for (const url of requests) expect(url.searchParams.get('hideDevelopment')).toBe('1')
  expect(host.textContent).not.toMatch(/上一页|下一页|第 1 \/.*页/)
  const summary = host.querySelector('[role="status"]')?.textContent
  if (total > 5000) { expect(summary).toMatch(/5,000.*5,001.*缩小查询范围/); expect(host.querySelector('.desktop-page-description')?.textContent).toContain('请缩小查询范围') }
  else expect(summary).toBe(`共 ${total.toLocaleString()} 个`)
}, 20000)
test('第二批读取失败拒绝部分用户，可沿原条件重试', async () => {
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 201)
  await mount(); await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(cache()?.state.data).toBeUndefined(); expect(host.textContent).not.toMatch(/USER-SYN-|共 201 个|暂无数据/)
  respond = url => batch(url, 201); await click('重试'); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect((cache()?.state.data as { list: unknown[] }).list).toHaveLength(201)
})
test('缓存403不展示旧用户或成功计数，未应用搜索草稿保留', async () => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(cache()?.state.status).toBe('success'))
  const input = host.querySelector<HTMLInputElement>('[placeholder="搜索账号或姓名"]')!; await change(input, '尚未应用')
  respond = () => failure(403); await act(async () => { await query.invalidateQueries({ queryKey: ['users'] }) }); await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(host.textContent).not.toMatch(/USER-SYN-|共 1 个/); expect(input.value).toBe('尚未应用')
  respond = url => batch(url, 1); await click('重试'); await wait(() => expect(cache()?.state.status).toBe('success'))
  for (const url of requests) expect(url.searchParams.get('keyword')).toBe('')
})
test('搜索和开发账号筛选沿原权限及参数，保留待输入草稿', async () => {
  respond = url => batch(url, 201); await mount(); await wait(() => expect(cache()?.state.status).toBe('success'))
  const input = host.querySelector<HTMLInputElement>('[placeholder="搜索账号或姓名"]')!; await change(input, 'APPLIED'); await click('搜索'); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(requests.slice(-2).every(url => url.searchParams.get('keyword') === 'APPLIED')).toBe(true)
  await change(input, '尚未应用')
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(requests.slice(-2).every(url => url.searchParams.get('hideDevelopment') === '0' && url.searchParams.get('keyword') === 'APPLIED')).toBe(true)
  expect(input.value).toBe('尚未应用')
})
test('加载中不宣称成功零条', async () => {
  let release!: (value: Response) => void; respond = () => new Promise(resolve => { release = resolve }); await mount()
  expect(host.textContent).not.toContain('共 0 个')
  await act(async () => release(batch(requests.at(-1)!, 0))); await wait(() => expect(host.textContent).toContain('共 0 个'))
})
test('5000用户虚拟挂载有界，滚动末行仍可达', async () => {
  respond = url => batch(url, 5000); await mount(); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) }); await wait(() => expect(host.textContent).toContain('USER-SYN-5000'))
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
}, 20000)
test('虚拟列表的重置弹窗保留原聚焦行，取消后自然回焦', async () => {
  respond = url => batch(url, 5000); await mount(); await wait(() => expect(cache()?.state.status).toBe('success'))
  await click('更多操作'); await wait(() => expect(document.querySelector('[role="menuitem"]')).not.toBeNull())
  const source = host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!
  await click('重置密码'); await wait(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) }); await wait(() => expect(host.textContent).toContain('USER-SYN-5000'))
  expect(source.isConnected).toBe(true)
  await click('取消', document.querySelector('[role="dialog"]')!); await wait(() => expect(document.activeElement).toBe(source))
  expect(unexpected).toEqual([])
}, 20000)

test.each(['hidden', 'unmounted'] as const)('首批在途%s后不再续批，恢复从第1批重新读取', async state => {
  let release!: (value: Response) => void, first = true
  respond = url => first ? (first = false, new Promise(resolve => { release = resolve })) : batch(url, 201)
  await mount(); await wait(() => expect(release).toBeTypeOf('function'))
  const original = requests[0]
  if (state === 'hidden') await mount(false)
  else { await act(async () => root.unmount()); root = createRoot(host) }
  await act(async () => { release(batch(original, 201)); await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(requests).toHaveLength(1)
  await mount(); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(requests.map(url => url.searchParams.get('page'))).toEqual(['1', '1', '2'])
})

test.each([1, 2].flatMap(delayedPage => (['base', 'session', 'user'] as const).map(change => ({ delayedPage, change }))))('用户第$delayedPage批在途切换$change后拒绝旧结果且不续批', async ({ delayedPage, change }) => {
  let release!: (value: Response) => void
  respond = url => Number(url.searchParams.get('page')) === delayedPage ? new Promise(resolve => { release = resolve }) : batch(url, 401)
  await mount(); await wait(() => expect(release).toBeTypeOf('function'))
  const pending = requests.at(-1)!
  expect(requests).toHaveLength(delayedPage)
  await act(async () => {
    if (change === 'base') setApiClientBaseURL('http://users-other.fixture.invalid/api')
    else if (change === 'session') useAuthStore.setState({ sessionGeneration: 11 })
    else useAuthStore.setState({ user: { ...useAuthStore.getState().user!, id: 8 } })
    release(batch(pending, 401))
  })
  await wait(() => expect(cache()?.state.fetchStatus).toBe('idle'))
  expect(requests, `${change}不得续发第${delayedPage + 1}批`).toHaveLength(delayedPage)
  expect(cache()?.state.status, change).toBe('error')
  expect(cache()?.state.data, change).toBeUndefined()
  expect(host.textContent).not.toMatch(/USER-SYN-|共 401 个/)
  expect(requests.every(url => url.origin === 'http://users-paging.fixture.invalid')).toBe(true)
})

test('用户列表同一账号会话正常刷新令牌仍可续批取齐', async () => {
  let release!: (value: Response) => void
  respond = url => Number(url.searchParams.get('page')) === 1 ? new Promise(resolve => { release = resolve }) : batch(url, 401)
  await mount(); await wait(() => expect(release).toBeTypeOf('function'))
  await act(async () => { useAuthStore.setState({ token: 'synthetic-refreshed-only' }); release(batch(requests[0], 401)) })
  await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(requests).toHaveLength(3)
  expect((cache()?.state.data as { list: unknown[] }).list).toHaveLength(401)
})
