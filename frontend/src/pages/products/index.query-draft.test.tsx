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

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/router/routeRegistry', async original => ({
  ...await original<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === '/products' ? Page : () => <p>合成旁页</p>,
}))

const listPath = '/products', listApi = '/api/products', listKey = 'products'
const initialQuery = '?keyword=已应用商品&categoryId=3&status=1&supplierId=4&supplierName=合成供应商&minPrice=1.25&maxPrice=20.75&page=1'
const categories = [{ id: 3, name: '合成分类A', status: 1, children: [] }, { id: 5, name: '合成分类B', status: 1, children: [] }]
const applied = { keyword: '已应用商品', category: '合成分类A', status: '启用', supplier: '合成供应商', minPrice: '1.25', maxPrice: '20.75' }
const draft = { keyword: '未应用商品', category: '合成分类B', status: '停用', supplier: '选择供应商', minPrice: '2.5', maxPrice: '30.5' }
let host: HTMLDivElement, root: Root, query: QueryClient
let respondList: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (url.origin !== 'http://query-draft-02.fixture.invalid' || method !== 'GET' || ![listApi, '/api/categories/tree', '/api/suppliers'].includes(url.pathname)) {
    unexpected.push(`${method} ${url.origin}${url.pathname}`)
    return response({ success: false, code: 'FIXTURE_REQUEST_DENIED', message: '禁止未声明请求' }, 403)
  }
  requests.push(url)
  if (url.pathname === listApi) return respondList(url)
  if (url.pathname === '/api/categories/tree') return response({ success: true, data: categories })
  return response({ success: true, data: { list: [{ id: 4, name: '合成供应商' }], pagination: { page: 1, pageSize: 200, total: 1 } } })
})
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function listResponse(revision = 0) {
  const list = revision ? [{ id: 10, code: `SYN${revision}`, name: `合成商品${revision}`, isActive: true, categoryId: 3, categoryName: '合成分类A', unit: '个' }] : []
  return response({ success: true, data: { list, pagination: { page: 1, pageSize: 200, total: list.length } } })
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
const prices = () => [...dialog().querySelectorAll<HTMLInputElement>('input[type="number"]')]
function fields() {
  const supplier = [...dialog().querySelectorAll('label')].find(node => node.firstElementChild?.textContent === '供应商')!
  return { keyword: keyword().value, category: category().textContent, status: selection().textContent, supplier: supplier.querySelector('button')!.textContent, minPrice: prices()[0].value, maxPrice: prices()[1].value }
}
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
  await type(keyword(), draft.keyword); await selectCategory(draft.category); await select(draft.status)
  await act(async () => dialog().querySelector<HTMLButtonElement>('button[aria-label="清除供应商"]')!.click())
  await type(prices()[0], draft.minPrice); await type(prices()[1], draft.maxPrice)
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

test.each([200, 503])('PRODUCT-Q01 首次后台读取以 %i 完成时保留尚未应用的全部草稿', async status => {
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
test('PRODUCT-Q02 后台列表成功失败恢复都保留草稿且请求仍使用已应用条件', async () => {
  await ready(); await openQuery(); await edit()
  const input = keyword(); await act(async () => input.focus())
  let responseVersion = 0
  for (const status of [200, 503, 200]) {
    respondList = () => status === 200 ? listResponse(++responseVersion) : failure()
    await act(async () => { await query.invalidateQueries({ queryKey: [listKey] }) })
    await wait(() => expect(cache()?.state.status).toBe(status === 200 ? 'success' : 'error'))
    expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input)
    expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: applied.keyword, categoryId: '3', status: '1', supplierId: '4', minPrice: '1.25', maxPrice: '20.75', page: '1', pageSize: '200' })
  }
})
test('PRODUCT-Q03 分类选项正常更新不会覆盖本次未应用筛选', async () => {
  await ready(); await openQuery(); await edit()
  const before = listRequests().length; const input = keyword(); await act(async () => input.focus())
  await act(async () => { query.setQueryData(['categories', 'tree'], [...categories, { id: 6, name: '新合成分类', status: 1, children: [] }]) })
  await wait(() => expect(query.getQueryData(['categories', 'tree'])).toHaveLength(3))
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(before)
})
test('PRODUCT-Q04 父页重渲染不把草稿回填成已应用值', async () => {
  await ready(); await openQuery(); await edit()
  const before = listRequests().length; const input = keyword(); await act(async () => input.focus())
  await draw(1)
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(before)
})
test('PRODUCT-Q05 真实工作区隐藏返回保持草稿和原 URL 且不改变查询', async () => {
  await ready(); await openQuery(); await edit()
  const originalPath = path(), before = listRequests().length
  await click('切到旁页'); await wait(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  expect(path()).toBe('/warehouses')
  await click('返回原列表'); await wait(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  expect(fields()).toEqual(draft); expect(path()).toBe(originalPath); expect(listRequests()).toHaveLength(before)
})
test('PRODUCT-Q06 取消重开恢复已应用条件，重置只改草稿且应用后回本页默认', async () => {
  await ready(); await openQuery(); await edit()
  const before = listRequests().length
  await click('取消', dialog()); await openQuery(); expect(fields()).toEqual(applied)
  await click('重置', dialog()); expect(fields()).toEqual({ keyword: '', category: '全部分类', status: '全部状态', supplier: '选择供应商', minPrice: '', maxPrice: '' })
  expect(listRequests()).toHaveLength(before); expect(params()).toEqual(Object.fromEntries(new URLSearchParams(initialQuery)))
  await click('查询', dialog()); await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(''))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: '', page: '1', pageSize: '200' })
  expect(params()).toEqual({ page: '1' })
})
test('PRODUCT-Q07 应用与返回保留原参数，摘要移除及清空继续有效', async () => {
  await ready(); await openQuery(); await edit(); await click('查询', dialog())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, categoryId: '5', status: '0', minPrice: draft.minPrice, maxPrice: draft.maxPrice, page: '1', pageSize: '200' })
  expect(params()).toEqual({ keyword: draft.keyword, categoryId: '5', status: '0', minPrice: draft.minPrice, maxPrice: draft.maxPrice, page: '1' })
  const appliedPath = path(), before = listRequests().length
  await click('切到旁页'); await click('返回原列表'); expect(path()).toBe(appliedPath); expect(listRequests()).toHaveLength(before)
  await click('查询'); await wait(() => expect(fields()).toEqual(draft)); await click('取消', dialog())
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="移除「关键字：${draft.keyword}」"]`)!.click())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(''))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ ...{ keyword: draft.keyword, categoryId: '5', status: '0', minPrice: draft.minPrice, maxPrice: draft.maxPrice, page: '1', pageSize: '200' }, keyword: '' })
  await click('清空'); await wait(() => expect(params()).toEqual({ page: '1' }))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: '', page: '1', pageSize: '200' })
})
test('PRODUCT-Q08 关键字回车沿原合同应用当前全部草稿', async () => {
  await ready(); await openQuery(); await edit()
  await act(async () => keyword().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, categoryId: '5', status: '0', minPrice: draft.minPrice, maxPrice: draft.maxPrice, page: '1', pageSize: '200' }); expect(params()).toEqual({ keyword: draft.keyword, categoryId: '5', status: '0', minPrice: draft.minPrice, maxPrice: draft.maxPrice, page: '1' })
})
