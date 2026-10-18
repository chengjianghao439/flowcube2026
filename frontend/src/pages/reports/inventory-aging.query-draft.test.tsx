// @vitest-environment jsdom
// Real report page/query dialog, selectors, QueryClient, client and KeepAlive.
// Strict synthetic GET fixtures; business writes and unlisted reads are rejected.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './inventory-aging'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/router/routeRegistry', async original => ({
  ...await original<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === '/reports/inventory-aging' ? Page : () => <p>合成旁页</p>,
}))
const listPath = '/reports/inventory-aging', listKey = 'inventory-aging', apiPath = '/api/inventory/aging'
const applied = { keyword: '', warehouse: '全部仓库', staleDays: '90 天' }
const draft = { keyword: '未应用存放查询', warehouse: '合成仓B', staleDays: '120 天' }
const warehouses = [{ id: 8, name: '合成仓A' }, { id: 9, name: '合成仓B' }]

let host: HTMLDivElement, root: Root, query: QueryClient
let respondList: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (url.origin !== 'http://query-draft-06.fixture.invalid' || method !== 'GET' || ![apiPath, '/api/warehouses/active', '/api/inventory/aging/expiry'].includes(url.pathname)) {
    unexpected.push(`${method} ${url.origin}${url.pathname}`); return response({ success: false, message: '禁止未声明请求' }, 403)
  }
  requests.push(url)
  if (url.pathname === apiPath) return respondList(url)
  if (url.pathname === '/api/warehouses/active') return response({ success: true, data: warehouses })
  return response({ success: true, data: { list: [], warnDays: 30 } })
})
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
function row(revision = 1) { return { id: 'SYN'+revision, productId: 42, productCode: `R-SYN${revision}`, productName: `合成报表商品${revision}`, unit: '个', warehouseId: 9, warehouseName: '合成仓B', qty0_30: 1, qty30_60: 0, qty60_90: 0, qty90p: 0, totalQty: 1, totalValue: 1, avgAgeDays: 10, maxAgeDays: 10, lastOutboundAt: null, daysSinceOutbound: null, isStale: false } }
function listResponse(revision = 0) {
  const list = revision ? [row(revision)] : []
  return response({ success: true, data: { list, pagination: { page: 1, pageSize: 200, total: list.length }, buckets: [], staleDays: 90 } })
}
function failure() { return response({ success: false, code: 'SYNTHETIC_READ_FAILURE', message: '合成查询失败' }, 503) }
function Harness({ revision }: { revision: number }) {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-location>{location.pathname}{location.search}</output><output data-revision>{revision}</output>
    <button onClick={() => navigate('/warehouses')}>切到旁页</button><button onClick={() => navigate(getWorkspaceListPath(listPath))}>返回原列表</button><KeepAliveOutlet /></>
}
async function draw(revision = 0) { await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[listPath]}><Harness revision={revision} /></MemoryRouter></QueryClientProvider>)) }
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
function button(label: string, scope: ParentNode = host) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)
  expect(found, `缺少按钮 ${label}`).toBeTruthy(); return found!
}
async function click(label: string, scope: ParentNode = host) { await act(async () => button(label, scope).click()) }
const keyword = () => dialog().querySelector<HTMLInputElement>('input[placeholder="请输入关键字…"]')!
function selected(label: string) { return [...dialog().querySelectorAll('label')].find(node => node.firstElementChild?.textContent === label)!.querySelector<HTMLButtonElement>('[role="combobox"]')! }
function fields() { return { keyword: keyword().value, warehouse: selected('仓库').textContent, staleDays: selected('滞销阈值').textContent } }
async function type(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
async function settleDisclosure() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function select(label: string, optionLabel: string) {
  await act(async () => selected(label).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === optionLabel)
  expect(option, `缺少选项 ${optionLabel}`).toBeTruthy(); await act(async () => option!.click()); await settleDisclosure()
}
async function edit() { await type(keyword(), draft.keyword); await select('仓库', draft.warehouse); await select('滞销阈值', draft.staleDays) }
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
const listRequests = () => requests.filter(url => url.pathname === apiPath)
const path = () => host.querySelector('[data-location]')!.textContent!
const cache = () => query.getQueryCache().find({ queryKey: [listKey], exact: false })
async function ready() { await draw(); await wait(() => expect(cache()?.state.status).toBe('success')) }
async function openQuery() { await click('查询'); await wait(() => expect(fields()).toEqual(applied)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); requests.length = 0; unexpected.length = 0; transport.mockClear()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  setApiClientBaseURL('http://query-draft-06.fixture.invalid/api'); apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('fetch', transport); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); Element.prototype.scrollIntoView = vi.fn()
  respondList = () => listResponse(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60000, staleTime: Infinity }, mutations: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear(); disposeWorkspaceHistoryGuard()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); vi.restoreAllMocks(); vi.unstubAllGlobals(); expect(unexpected).toEqual([])
})
test.each([200, 503])('AGING-Q01 首次读取以 %i 完成保留尚未应用草稿', async status => {
  let release!: (value: Response) => void; respondList = () => new Promise(resolve => { release = resolve })
  await draw(); await wait(() => expect(release).toBeTypeOf('function')); await openQuery(); await edit()
  const input = keyword(); await act(async () => input.focus()); expect(fields()).toEqual(draft)
  await act(async () => release(status === 200 ? listResponse() : failure()))
  await wait(() => expect(cache()?.state.status).toBe(status === 200 ? 'success' : 'error'))
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(1)
})
test('AGING-Q02 后台数据变化失败恢复不覆盖草稿或应用新筛选', async () => {
  await ready(); await openQuery(); await edit(); const input = keyword(); await act(async () => input.focus()); let revision = 0
  for (const status of [200, 503, 200]) {
    respondList = () => status === 200 ? listResponse(++revision) : failure()
    await act(async () => { await query.invalidateQueries({ queryKey: [listKey] }) })
    await wait(() => expect(cache()?.state.status).toBe(status === 200 ? 'success' : 'error'))
    expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input)
    expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ staleDays: '90', page: '1', pageSize: '200' })
  }
})
test('AGING-Q03 父页重渲染保留未应用字段与焦点', async () => {
  await ready(); await openQuery(); await edit(); const before = listRequests().length; const input = keyword(); await act(async () => input.focus())
  await draw(1); expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(before)
})
test('AGING-Q04 真实工作区隐藏再恢复保留草稿与当前页面', async () => {
  await ready(); await openQuery(); await edit(); const original = path(), before = listRequests().length
  await click('切到旁页'); await wait(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  await click('返回原列表'); await wait(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  expect(fields()).toEqual(draft); expect(path()).toBe(original); expect(listRequests()).toHaveLength(before)
})
test('AGING-Q05 取消重开载入已应用条件，reset仅改草稿并保持原默认', async () => {
  await ready(); await openQuery(); await edit(); const before = listRequests().length
  await click('取消', dialog()); await openQuery(); expect(fields()).toEqual(applied)
  await click('重置', dialog()); expect(fields()).toEqual(applied); expect(listRequests()).toHaveLength(before)
  await click('查询', dialog()); await act(async () => { await query.invalidateQueries({ queryKey: [listKey] }) })
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ staleDays: '90', page: '1', pageSize: '200' })
})
test('AGING-Q06 应用筛选、返回、重开和清空保留原本地查询合同', async () => {
  await ready(); await openQuery(); await edit(); await click('查询', dialog())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, warehouseId: '9', staleDays: '120', page: '1', pageSize: '200' })
  const original = path(), before = listRequests().length
  await click('切到旁页'); await click('返回原列表'); expect(path()).toBe(original); expect(listRequests()).toHaveLength(before)
  await click('查询'); await wait(() => expect(fields()).toEqual(draft)); await click('取消', dialog()); await click('清空')
  await act(async () => { await query.invalidateQueries({ queryKey: [listKey] }) })
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ staleDays: '90', page: '1', pageSize: '200' })
  await openQuery(); expect(fields()).toEqual(applied)
})
test('AGING-Q07 回车应用当前全部草稿', async () => {
  await ready(); await openQuery(); await edit(); await act(async () => keyword().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, warehouseId: '9', staleDays: '120', page: '1', pageSize: '200' })
})
test('AGING-Q08 切换效期预警再返回保留已应用查询与原阈值', async () => {
  await ready(); await openQuery(); await edit(); await click('查询', dialog()); await wait(() => expect(listRequests().at(-1)?.searchParams.get('staleDays')).toBe('120'))
  await click('效期预警'); await wait(() => expect(requests.some(url => url.pathname === '/api/inventory/aging/expiry')).toBe(true))
  const expiry = requests.find(url => url.pathname === '/api/inventory/aging/expiry')!
  expect(Object.fromEntries(expiry.searchParams)).toEqual({ warehouseId: '9', warnDays: '30' })
  await click('存放明细'); await click('查询'); await wait(() => expect(fields()).toEqual(draft))
})
