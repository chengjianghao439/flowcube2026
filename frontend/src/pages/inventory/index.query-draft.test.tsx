// @vitest-environment jsdom
// Real page, query dialogs, query cache, API client and KeepAliveOutlet.
// All transport is synthetic, read-only and allowlisted; no app or database is started.
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
import { defaultRangeYmds } from '@/lib/dateTime'
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/router/routeRegistry', async original => ({
  ...await original<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === '/inventory' ? Page : () => <p>合成旁页</p>,
}))

const listPath = '/inventory', listApi = '/api/inventory/overview', listKey = 'inventory-overview'
const initialQuery = '?tab=overview&keyword=已应用商品&categoryId=3&warehouseId=8&warehouseName=合成仓A&logStartDate=2026-10-01&logEndDate=2026-10-14&logType=2&logWarehouseId=8&logWarehouseName=合成仓A&page=1'
const categories = [{ id: 3, name: '合成分类A', status: 1, children: [] }, { id: 5, name: '合成分类B', status: 1, children: [] }]
const warehouses = [{ id: 8, name: '合成仓A' }, { id: 9, name: '合成仓B' }]
const applied = { keyword: '已应用商品', category: '合成分类A', warehouse: '合成仓A' }
const draft = { keyword: '未应用商品', category: '合成分类B', warehouse: '合成仓B' }
let host: HTMLDivElement, root: Root, query: QueryClient
let respondList: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (url.origin !== 'http://query-draft-02.fixture.invalid' || method !== 'GET' || ![listApi, '/api/categories/tree', '/api/warehouses/active', '/api/inventory/logs'].includes(url.pathname)) {
    unexpected.push(`${method} ${url.origin}${url.pathname}`)
    return response({ success: false, code: 'FIXTURE_REQUEST_DENIED', message: '禁止未声明请求' }, 403)
  }
  requests.push(url)
  if (url.pathname === listApi) return respondList(url)
  if (url.pathname === '/api/categories/tree') return response({ success: true, data: categories })
  if (url.pathname === '/api/warehouses/active') return response({ success: true, data: warehouses })
  return listResponse()
})
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function listResponse(revision = 0) {
  const list = revision ? [{ id: 10, productId: 10, productCode: `SYN${revision}`, productName: `合成商品${revision}`, unit: '个', warehouseId: 8, warehouseName: '合成仓A', categoryId: 3, onHand: 1, reserved: 0, available: 1 }] : []
  return response({ success: true, data: { list, pagination: { page: 1, pageSize: 200, total: list.length }, stats: { totalSkus: list.length, totalOnHand: list.length, totalReserved: 0, totalAvailable: list.length, quantitiesByUnit: { complete: true, matchedRows: list.length, groups: list.length ? [{ unit: '个', onHand: 1, reserved: 0 }] : [] } } } })
}
function failure() { return response({ success: false, code: 'SYNTHETIC_READ_FAILURE', message: '合成查询读取失败' }, 503) }
function Harness({ revision }: { revision: number }) {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-location>{location.pathname}{location.search}</output><output data-revision>{revision}</output>
    <button onClick={() => navigate('/warehouses')}>切到旁页</button>
    <button onClick={() => navigate(getWorkspaceListPath(listPath))}>返回原列表</button><KeepAliveOutlet /></>
}
async function draw(revision = 0, search = initialQuery) {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[listPath + search]}><Harness revision={revision} /></MemoryRouter></QueryClientProvider>))
}
function dialog() { return document.querySelector<HTMLElement>('[role="dialog"]')! }
function button(label: string, scope: ParentNode = host) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)
  expect(found, `缺少按钮 ${label}`).toBeTruthy(); return found!
}
async function click(label: string, scope: ParentNode = host) { await act(async () => button(label, scope).click()) }
const keyword = () => dialog().querySelector<HTMLInputElement>('input[placeholder="请输入关键字…"]')!
const category = () => dialog().querySelector<HTMLButtonElement>('button[aria-label="请选择分类"]')!
const selection = () => dialog().querySelector<HTMLButtonElement>('[role="combobox"]')!
function fields() { return { keyword: keyword().value, category: category().textContent, warehouse: selection().textContent } }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function settleDisclosure() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function select(label: string) {
  await act(async () => selection().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === label)
  expect(option, `缺少选项 ${label}`).toBeTruthy(); await act(async () => option!.click()); await settleDisclosure()
}
async function selectCategory(label: string) {
  await act(async () => category().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!
  await click(label, menu); await settleDisclosure()
}
async function edit() {
  await type(keyword(), draft.keyword); await selectCategory(draft.category); await select(draft.warehouse)

}
async function wait(assertion: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() })
}
const listRequests = () => requests.filter(url => url.pathname === listApi)
const path = () => host.querySelector('[data-location]')!.textContent!
const params = () => Object.fromEntries(new URLSearchParams(path().split('?')[1]))
const cache = () => query.getQueryCache().find({ queryKey: [listKey], exact: false })
async function ready() {
  await draw(); await wait(() => expect(cache()?.state.status).toBe('success'))
  await wait(() => expect(query.getQueryData(['categories', 'tree'])).toEqual(categories))
}
async function openQuery() { await click('查询'); await wait(() => expect(fields()).toEqual(applied)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); requests.length = 0; unexpected.length = 0; transport.mockClear()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  setApiClientBaseURL('http://query-draft-02.fixture.invalid/api')
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('fetch', transport)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  respondList = () => listResponse()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60000, staleTime: Infinity }, mutations: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear(); disposeWorkspaceHistoryGuard()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); vi.restoreAllMocks(); vi.unstubAllGlobals()
  expect(unexpected).toEqual([])
})

test.each([200, 503])('INVENTORY-Q01 首次后台读取以 %i 完成时保留尚未应用的全部草稿', async status => {
  let release!: (value: Response) => void
  respondList = () => new Promise(resolve => { release = resolve })
  await draw(); await wait(() => expect(release).toBeTypeOf('function')); await openQuery(); await edit()
  const input = keyword(); await act(async () => input.focus()); expect(fields()).toEqual(draft)
  await act(async () => release(status === 200 ? listResponse() : failure()))
  await wait(() => expect(cache()?.state.status).toBe(status === 200 ? 'success' : 'error'))
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input)
  expect(params()).toEqual(Object.fromEntries(new URLSearchParams(initialQuery)))
  expect(listRequests()).toHaveLength(1)
})
test('INVENTORY-Q02 后台列表成功失败恢复都保留草稿且请求仍使用已应用条件', async () => {
  await ready(); await openQuery(); await edit()
  const input = keyword(); await act(async () => input.focus())
  let responseVersion = 0
  for (const status of [200, 503, 200]) {
    respondList = () => status === 200 ? listResponse(++responseVersion) : failure()
    await act(async () => { await query.invalidateQueries({ queryKey: [listKey] }) })
    await wait(() => expect(cache()?.state.status).toBe(status === 200 ? 'success' : 'error'))
    expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input)
    expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: applied.keyword, categoryId: '3', warehouseId: '8', page: '1', pageSize: '200' })
  }
})
test('INVENTORY-Q03 分类选项正常更新不会覆盖本次未应用筛选', async () => {
  await ready(); await openQuery(); await edit()
  const before = listRequests().length; const input = keyword(); await act(async () => input.focus())
  await act(async () => { query.setQueryData(['categories', 'tree'], [...categories, { id: 6, name: '新合成分类', status: 1, children: [] }]) })
  await wait(() => expect(query.getQueryData(['categories', 'tree'])).toHaveLength(3))
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(before)
})
test('INVENTORY-Q04 父页重渲染不把草稿回填成已应用值', async () => {
  await ready(); await openQuery(); await edit()
  const before = listRequests().length; const input = keyword(); await act(async () => input.focus())
  await draw(1)
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(before)
})
test('INVENTORY-Q05 真实工作区隐藏返回保持草稿和原 URL 且不改变查询', async () => {
  await ready(); await openQuery(); await edit()
  const originalPath = path(), before = listRequests().length
  await click('切到旁页'); await wait(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  expect(path()).toBe('/warehouses')
  await click('返回原列表'); await wait(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  expect(fields()).toEqual(draft); expect(path()).toBe(originalPath); expect(listRequests()).toHaveLength(before)
})
test('INVENTORY-Q06 取消重开恢复已应用条件，重置只改草稿且应用后回本页默认', async () => {
  await ready(); await openQuery(); await edit()
  const before = listRequests().length
  await click('取消', dialog()); await openQuery(); expect(fields()).toEqual(applied)
  await click('重置', dialog()); expect(fields()).toEqual({ keyword: '', category: '全部分类', warehouse: '全部仓库' })
  expect(listRequests()).toHaveLength(before); expect(params()).toEqual(Object.fromEntries(new URLSearchParams(initialQuery)))
  await click('查询', dialog()); await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(''))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: '', page: '1', pageSize: '200' })
  expect(params()).toEqual({ tab: 'overview', page: '1', logStartDate: '2026-10-01', logEndDate: '2026-10-14', logType: '2', logWarehouseId: '8', logWarehouseName: '合成仓A' })
})
test('INVENTORY-Q07 应用与返回保留原参数，摘要移除及清空继续有效', async () => {
  await ready(); await openQuery(); await edit(); await click('查询', dialog())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, categoryId: '5', warehouseId: '9', page: '1', pageSize: '200' })
  expect(params()).toEqual({ tab: 'overview', keyword: draft.keyword, categoryId: '5', warehouseId: '9', warehouseName: '合成仓B', page: '1', logStartDate: '2026-10-01', logEndDate: '2026-10-14', logType: '2', logWarehouseId: '8', logWarehouseName: '合成仓A' })
  const appliedPath = path(), before = listRequests().length
  await click('切到旁页'); await click('返回原列表'); expect(path()).toBe(appliedPath); expect(listRequests()).toHaveLength(before)
  await click('查询'); await wait(() => expect(fields()).toEqual(draft)); await click('取消', dialog())
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="移除「关键字：${draft.keyword}」"]`)!.click())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(''))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ ...{ keyword: draft.keyword, categoryId: '5', warehouseId: '9', page: '1', pageSize: '200' }, keyword: '' })
  await click('清空'); await wait(() => expect(params()).toEqual({ tab: 'overview', page: '1', logStartDate: '2026-10-01', logEndDate: '2026-10-14', logType: '2', logWarehouseId: '8', logWarehouseName: '合成仓A' }))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: '', page: '1', pageSize: '200' })
})
test('INVENTORY-Q08 关键字回车沿原合同应用当前全部草稿', async () => {
  await ready(); await openQuery(); await edit()
  await act(async () => keyword().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, categoryId: '5', warehouseId: '9', page: '1', pageSize: '200' }); expect(params()).toEqual({ tab: 'overview', keyword: draft.keyword, categoryId: '5', warehouseId: '9', warehouseName: '合成仓B', page: '1', logStartDate: '2026-10-01', logEndDate: '2026-10-14', logType: '2', logWarehouseId: '8', logWarehouseName: '合成仓A' })
})
test('INVENTORY-Q09 总览筛选与流水既有日期相互保留，流水重置回七日默认', async () => {
  await ready(); await click('出入库记录')
  await wait(() => expect(requests.some(url => url.pathname === '/api/inventory/logs')).toBe(true))
  const logRequest = requests.find(url => url.pathname === '/api/inventory/logs')!
  expect(Object.fromEntries(logRequest.searchParams)).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-14', type: '2', warehouseId: '8', page: '1', pageSize: '200' })
  await click('查询')
  const dates = () => [...dialog().querySelectorAll<HTMLInputElement>('input[placeholder="yyyy-mm-dd"]')]
  expect(dates().map(input => input.value)).toEqual(['2026-10-01', '2026-10-14'])
  const before = requests.length; await click('重置', dialog())
  const defaults = defaultRangeYmds(7)
  expect(dates().map(input => input.value)).toEqual([defaults.start, defaults.end]); expect(requests).toHaveLength(before)
  await click('取消', dialog()); await click('库存总览'); await openQuery()
  expect(fields()).toEqual(applied); expect(params()).toEqual(Object.fromEntries(new URLSearchParams(initialQuery)))
})
test('INVENTORY-Q10 无日期的流水首次查询和重置仍使用页面七日默认', async () => {
  await draw(0, '?tab=logs'); await wait(() => expect(requests.some(url => url.pathname === '/api/inventory/logs')).toBe(true))
  const defaults = defaultRangeYmds(7), request = requests.find(url => url.pathname === '/api/inventory/logs')!
  expect(Object.fromEntries(request.searchParams)).toMatchObject({ startDate: defaults.start, endDate: defaults.end, page: '1', pageSize: '200' })
  await click('查询'); const dates = [...dialog().querySelectorAll<HTMLInputElement>('input[placeholder="yyyy-mm-dd"]')]
  expect(dates.map(input => input.value)).toEqual([defaults.start, defaults.end])
  await click('重置', dialog()); expect(dates.map(input => input.value)).toEqual([defaults.start, defaults.end])
  expect(params()).toEqual({ tab: 'logs' })
})
