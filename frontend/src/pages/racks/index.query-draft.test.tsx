// @vitest-environment jsdom
// Real page, QueryDialog, BaseCrudPage, KeepAliveOutlet and query cache.
// Only permission/toast fixtures and the synthetic GET transport are substituted.
// No app, database, business write or external request is used by this suite.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './index'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/router/routeRegistry', async original => ({
  ...await original<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === '/racks' ? Page : () => <p>合成旁页</p>,
}))

const listPath = '/racks', listKey = 'racks'
const warehouse = { id: 8, name: '合成仓' }
const applied = { keyword: '已应用关键字', zone: 'A', warehouse: '合成仓' }
const draft = { keyword: '尚未应用的关键字', zone: 'B', warehouse: '合成仓' }
let host: HTMLDivElement, root: Root, query: QueryClient
let respondWarehouses: () => Response | Promise<Response>
let respondList: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (url.origin !== 'http://query-draft.fixture.invalid' || method !== 'GET' || !['/api/racks', '/api/warehouses/active'].includes(url.pathname)) {
    unexpected.push(`${method} ${url.origin}${url.pathname}`)
    return response({ success: false, message: '禁止未声明请求' }, 403)
  }
  requests.push(url)
  return url.pathname === '/api/warehouses/active' ? respondWarehouses() : respondList(url)
})
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function listResponse() {
  return response({ success: true, data: { list: [], pagination: { page: 1, pageSize: 200, total: 0 } } })
}
function Harness({ revision }: { revision: number }) {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-location>{location.pathname}{location.search}</output><output data-revision>{revision}</output>
    <button onClick={() => navigate('/warehouses')}>切到旁页</button>
    <button onClick={() => navigate(getWorkspaceListPath(listPath))}>返回原列表</button><KeepAliveOutlet /></>
}
async function draw(revision = 0) {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[listPath]}><Harness revision={revision} /></MemoryRouter></QueryClientProvider>))
}
function dialog() { return document.querySelector<HTMLElement>('[role="dialog"]')! }
function button(label: string, scope: ParentNode = host) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)
  expect(found, `缺少按钮 ${label}`).toBeTruthy()
  return found!
}
async function click(label: string, scope: ParentNode = host) { await act(async () => button(label, scope).click()) }
const keyword = () => dialog().querySelector<HTMLInputElement>('input[placeholder="请输入关键字…"]')!
const zone = () => dialog().querySelector<HTMLInputElement>('input[placeholder="按库区（如 A/B/C）查询…"]')!
const selections = () => [...dialog().querySelectorAll<HTMLButtonElement>('[role="combobox"]')]
function fields() {
  return { keyword: keyword().value, zone: zone().value, warehouse: selections()[0].textContent }
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function select(index: number, label: string) {
  await act(async () => selections()[index].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === label)
  expect(option, `缺少选项 ${label}`).toBeTruthy()
  await act(async () => option!.click())
  // 等待真实 Select Portal 的卸载回焦，再安排后续输入焦点。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function edit(values: typeof draft) {
  await type(keyword(), values.keyword); await type(zone(), values.zone)
  await select(0, values.warehouse)

}
async function wait(assertion: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() })
}
const listRequests = () => requests.filter(url => url.pathname === `/api${listPath}`)
async function ready() {
  await draw()
  await wait(() => expect(query.getQueryCache().find({ queryKey: [listKey], exact: false })?.state.status).toBe('success'))
  await wait(() => expect(query.getQueryData(['warehouses-simple'])).toEqual([warehouse]))
}
async function openQuery() {
  await click('查询')
  await wait(() => expect(query.getQueryData(['warehouses', 'active'])).toEqual([warehouse]))
}
async function apply() {
  await openQuery(); await edit(applied); await click('查询', dialog())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(applied.keyword))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); requests.length = 0; unexpected.length = 0; transport.mockClear()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  setApiClientBaseURL('http://query-draft.fixture.invalid/api')
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('fetch', transport)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  respondWarehouses = () => response({ success: true, data: [warehouse] })
  respondList = () => listResponse()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity }, mutations: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear(); disposeWorkspaceHistoryGuard()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); vi.restoreAllMocks(); vi.unstubAllGlobals()
  expect(unexpected).toEqual([])
})

test('RACK-Q01 仓库首次正常读取完成不覆盖打开的关键字与库区草稿', async () => {
  const releases: Array<(value: Response) => void> = []
  respondWarehouses = () => new Promise(resolve => { releases.push(resolve) })
  await draw(); await wait(() => expect(releases.length).toBeGreaterThan(0))
  await click('查询'); await type(keyword(), draft.keyword); await type(zone(), draft.zone)
  const input = keyword(); await act(async () => input.focus())
  await act(async () => { for (const release of releases) release(response({ success: true, data: [warehouse] })) })
  await wait(() => expect(query.getQueryData(['warehouses-simple'])).toEqual([warehouse]))
  expect({ keyword: keyword().value, zone: zone().value }).toEqual({ keyword: draft.keyword, zone: draft.zone })
  expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(1)
})
test('RACK-Q02 仓库选项正常更新保留已选与未应用的全部草稿及焦点', async () => {
  await ready(); await openQuery(); await edit(draft)
  const input = keyword(); await act(async () => input.focus()); expect(fields()).toEqual(draft)
  await act(async () => { query.setQueryData(['warehouses-simple'], [warehouse, { id: 9, name: '新合成仓' }]) })
  await wait(() => expect(query.getQueryData(['warehouses-simple'])).toHaveLength(2))
  await wait(() => expect(host.textContent).toContain('货架管理'))
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input)
  expect(listRequests()).toHaveLength(1)
})
test('RACK-Q03 父组件重渲染保留未应用草稿且不发起新列表查询', async () => {
  await ready(); await apply(); await openQuery(); await edit(draft)
  const before = listRequests().length; const input = keyword(); await act(async () => input.focus())
  await draw(1)
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input)
  expect(listRequests()).toHaveLength(before)
})
test('RACK-Q04 列表读取成功或失败均不应用或覆盖查询草稿', async () => {
  await ready(); await apply(); await openQuery(); await edit(draft)
  const input = keyword(); await act(async () => input.focus())
  for (const status of [200, 503, 200]) {
    respondList = () => status === 200 ? listResponse() : response({ success: false, message: '合成列表失败' }, status)
    await act(async () => { await query.invalidateQueries({ queryKey: [listKey] }) })
    await wait(() => expect(query.getQueryCache().find({ queryKey: [listKey, applied.keyword], exact: false })?.state.status).toBe(status === 200 ? 'success' : 'error'))
    expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input)
    expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(applied.keyword)
  }
})
test('RACK-Q05 真实工作区隐藏并恢复保留未应用草稿与原已应用筛选', async () => {
  await ready(); await apply(); await openQuery(); await edit(draft)
  const before = listRequests().length
  await click('切到旁页'); await wait(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  expect(host.querySelector('[data-location]')?.textContent).toBe('/warehouses')
  await click('返回原列表'); await wait(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  await wait(() => expect(query.getQueryData(['warehouses', 'active'])).toEqual([warehouse]))
  expect(fields()).toEqual(draft); expect(host.querySelector('[data-location]')?.textContent).toBe(listPath)
  expect(host.textContent).toContain(`关键字：${applied.keyword}`); expect(listRequests()).toHaveLength(before)
})
test('RACK-Q06 取消重开恢复已应用值，重置仅改草稿且查询后才回本页默认', async () => {
  await ready(); await apply(); await openQuery(); await edit(draft)
  const before = listRequests().length
  await click('取消', dialog()); await openQuery()
  expect(fields()).toEqual(applied); expect(listRequests()).toHaveLength(before)
  await click('重置', dialog())
  expect(fields()).toEqual({ keyword: '', zone: '', warehouse: '全部仓库' })
  expect(listRequests()).toHaveLength(before); expect(host.textContent).toContain(`关键字：${applied.keyword}`)
  await click('查询', dialog())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(''))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: '', page: '1', pageSize: '200' })
})
test('RACK-Q07 应用筛选与工作区返回保持原请求合同，摘要移除与清空仍有效', async () => {
  await ready(); await apply()
  const expected = { keyword: applied.keyword, zone: applied.zone, warehouseId: '8', page: '1', pageSize: '200' }
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual(expected)
  const before = listRequests().length
  await click('切到旁页'); await click('返回原列表')
  expect(host.querySelector('[data-location]')?.textContent).toBe(listPath); expect(listRequests()).toHaveLength(before)
  await openQuery(); expect(fields()).toEqual(applied); await click('取消', dialog())
  const remove = host.querySelector<HTMLButtonElement>(`button[aria-label="移除「关键字：${applied.keyword}」"]`)!
  await act(async () => remove.click())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(''))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ ...expected, keyword: '' })
  await click('清空')
  await wait(() => expect(listRequests().at(-1)?.searchParams.has('warehouseId')).toBe(false))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: '', page: '1', pageSize: '200' })
})
test('RACK-Q08 关键字回车提交当前草稿并沿原筛选合同关闭弹窗', async () => {
  await ready(); await openQuery(); await edit(draft)
  await act(async () => keyword().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, zone: draft.zone, warehouseId: '8', page: '1', pageSize: '200' })
})
