// @vitest-environment jsdom
// Real page/query dialog, date/select controls, query cache, API and KeepAlive.
// Only transport and unrelated closed finder/detail-progress surfaces are fixtures.
import { act, type ReactNode } from 'react'
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
vi.mock('@/components/finder', () => ({ CustomerFinder: () => null, ProductFinder: () => null }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('@/router/routeRegistry', async original => ({
  ...await original<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === '/picking-waves' ? Page : () => <p>合成只读详情或旁页</p>,
}))
const listPath = '/picking-waves', listKey = 'picking-waves', apiPath = '/api/picking-waves'
const initial = '?keyword=PW-APPLIED&status=1&warehouseId=8&warehouseName=合成仓A&startDate=2026-10-01&endDate=2026-10-14'
const applied = { keyword: 'PW-APPLIED', status: '待拣货', warehouse: '合成仓A', startDate: '2026-10-01', endDate: '2026-10-14' }
const draft = { keyword: 'PW-DRAFT', status: '拣货中', warehouse: '合成仓B', startDate: '2026-10-02', endDate: '2026-10-13' }
const warehouses = [{ id: 8, name: '合成仓A' }, { id: 9, name: '合成仓B' }]
let host: HTMLDivElement, root: Root, query: QueryClient
let respondList: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (url.origin !== 'http://query-draft-03.fixture.invalid' || method !== 'GET' || ![apiPath, '/api/warehouses/active', '/api/picking-waves/42'].includes(url.pathname)) {
    unexpected.push(`${method} ${url.origin}${url.pathname}`); return response({ success: false, message: '禁止未声明请求' }, 403)
  }
  requests.push(url)
  if (url.pathname === apiPath) return respondList(url)
  if (url.pathname === '/api/warehouses/active') return response({ success: true, data: warehouses })
  return response({ success: true, data: { ...row(1), items: [] } })
})
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
function row(revision = 1) { return { id: 42, waveNo: `PW-SYN${revision}`, status: 4, statusName: '已完成', warehouseId: 8, warehouseName: '合成仓A', priority: 1, taskCount: 1, createdAt: '2026-10-01 08:00:00' } }
function listResponse(revision = 0) {
  const list = revision ? [row(revision)] : []
  return response({ success: true, data: { list, pagination: { page: 1, pageSize: 200, total: list.length } } })
}
function failure() { return response({ success: false, code: 'SYNTHETIC_READ_FAILURE', message: '合成查询失败' }, 503) }
function Harness({ revision }: { revision: number }) {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-location>{location.pathname}{location.search}</output><output data-revision>{revision}</output>
    <button onClick={() => navigate('/warehouses')}>切到旁页</button><button onClick={() => navigate(getWorkspaceListPath(listPath))}>返回原列表</button><KeepAliveOutlet /></>
}
async function draw(revision = 0, search = initial) {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[listPath + search]}><Harness revision={revision} /></MemoryRouter></QueryClientProvider>))
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
function button(label: string, scope: ParentNode = host) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)
  expect(found, `缺少按钮 ${label}`).toBeTruthy(); return found!
}
async function click(label: string, scope: ParentNode = host) { await act(async () => button(label, scope).click()) }
const keyword = () => dialog().querySelector<HTMLInputElement>('input[placeholder="请输入批次号…"]')!
const dates = () => [...dialog().querySelectorAll<HTMLInputElement>('input[placeholder="yyyy-mm-dd"]')]
function field(label: string) { return [...dialog().querySelectorAll('label')].find(node => node.firstElementChild?.textContent === label)! }
const selected = (label: string) => field(label).querySelector<HTMLButtonElement>('[role="combobox"]')!
function fields() { return { keyword: keyword().value, status: selected('状态').textContent, warehouse: selected('仓库').textContent, startDate: dates()[0].value, endDate: dates()[1].value } }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function date(input: HTMLInputElement, value: string) { await type(input, value); await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))) }
async function settleDisclosure() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function select(label: string, optionLabel: string) {
  await act(async () => selected(label).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === optionLabel)
  expect(option, `缺少选项 ${optionLabel}`).toBeTruthy(); await act(async () => option!.click()); await settleDisclosure()
}
async function edit() {
  await type(keyword(), draft.keyword); await select('状态', draft.status); await select('仓库', draft.warehouse)
  await date(dates()[0], draft.startDate); await date(dates()[1], draft.endDate)

}
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
const listRequests = () => requests.filter(url => url.pathname === apiPath)
const path = () => host.querySelector('[data-location]')!.textContent!
const params = () => Object.fromEntries(new URLSearchParams(path().split('?')[1]))
const cache = () => query.getQueryCache().find({ queryKey: [listKey], exact: false })
async function ready() { await draw(); await wait(() => expect(cache()?.state.status).toBe('success')) }
async function openQuery() { await click('查询'); await wait(() => expect(fields()).toEqual(applied)) }
const defaultFields = () => ({ keyword: '', status: '全部状态', warehouse: '全部仓库', startDate: '', endDate: '' })
const defaultRequest = () => ({ keyword: '', page: '1', pageSize: '200' })
const defaultUrl = () => ({})
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); requests.length = 0; unexpected.length = 0; transport.mockClear()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  setApiClientBaseURL('http://query-draft-03.fixture.invalid/api'); apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('fetch', transport); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); Element.prototype.scrollIntoView = vi.fn()
  respondList = () => listResponse(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60000, staleTime: Infinity }, mutations: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear(); disposeWorkspaceHistoryGuard()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); vi.restoreAllMocks(); vi.unstubAllGlobals(); expect(unexpected).toEqual([])
})
test.each([200, 503])('WAVE-Q01 首读以 %i 完成不覆盖已编辑查询草稿', async status => {
  let release!: (value: Response) => void; respondList = () => new Promise(resolve => { release = resolve })
  await draw(); await wait(() => expect(release).toBeTypeOf('function')); await openQuery(); await edit()
  const input = keyword(); await act(async () => input.focus()); expect(fields()).toEqual(draft)
  await act(async () => release(status === 200 ? listResponse() : failure()))
  await wait(() => expect(cache()?.state.status).toBe(status === 200 ? 'success' : 'error'))
  expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(1)
  expect(params()).toEqual(Object.fromEntries(new URLSearchParams(initial)))
})
test('WAVE-Q02 后台列表数据变化、失败和恢复均保留未应用输入', async () => {
  await ready(); await openQuery(); await edit(); const input = keyword(); await act(async () => input.focus())
  let revision = 0
  for (const status of [200, 503, 200]) {
    respondList = () => status === 200 ? listResponse(++revision) : failure()
    await act(async () => { await query.invalidateQueries({ queryKey: [listKey] }) })
    await wait(() => expect(cache()?.state.status).toBe(status === 200 ? 'success' : 'error'))
    expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input)
    expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: applied.keyword, status: '1', warehouseId: '8', startDate: applied.startDate, endDate: applied.endDate, page: '1', pageSize: '200' })
  }
})
test('WAVE-Q03 父页重渲染不重放已应用筛选', async () => {
  await ready(); await openQuery(); await edit(); const before = listRequests().length; const input = keyword(); await act(async () => input.focus())
  await draw(1); expect(fields()).toEqual(draft); expect(document.activeElement).toBe(input); expect(listRequests()).toHaveLength(before)
})
test('WAVE-Q04 真实工作区隐藏恢复保留本次草稿与原筛选路径', async () => {
  await ready(); await openQuery(); await edit(); const original = path(), before = listRequests().length
  await click('切到旁页'); await wait(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  await click('返回原列表'); await wait(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  expect(fields()).toEqual(draft); expect(path()).toBe(original); expect(listRequests()).toHaveLength(before)
})
test('WAVE-Q05 取消重开恢复原条件，重置只改草稿且应用后使用本页默认', async () => {
  await ready(); await openQuery(); await edit(); const before = listRequests().length
  await click('取消', dialog()); await openQuery(); expect(fields()).toEqual(applied)
  await click('重置', dialog()); expect(fields()).toEqual(defaultFields()); expect(listRequests()).toHaveLength(before)
  expect(params()).toEqual(Object.fromEntries(new URLSearchParams(initial)))
  await click('查询', dialog()); await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(''))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual(defaultRequest()); expect(params()).toEqual(defaultUrl())
})
test('WAVE-Q06 应用后 URL 和网络保持原合同，返回及清空仍有效', async () => {
  await ready(); await openQuery(); await edit(); await click('查询', dialog())
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, status: '2', warehouseId: '9', startDate: draft.startDate, endDate: draft.endDate, page: '1', pageSize: '200' }); expect(params()).toEqual({ keyword: draft.keyword, status: '2', warehouseId: '9', warehouseName: draft.warehouse, startDate: draft.startDate, endDate: draft.endDate })
  const original = path(), before = listRequests().length
  await click('切到旁页'); await click('返回原列表'); expect(path()).toBe(original); expect(listRequests()).toHaveLength(before)
  await click('查询'); await wait(() => expect(fields()).toEqual(draft)); await click('取消', dialog())
  await click('清空'); await wait(() => expect(params()).toEqual({}))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: '', page: '1', pageSize: '200' })
})
test('WAVE-Q07 回车应用当前全部草稿，不改变原筛选合同', async () => {
  await ready(); await openQuery(); await edit()
  await act(async () => keyword().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await wait(() => expect(listRequests().at(-1)?.searchParams.get('keyword')).toBe(draft.keyword))
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual({ keyword: draft.keyword, status: '2', warehouseId: '9', startDate: draft.startDate, endDate: draft.endDate, page: '1', pageSize: '200' })
})
test('WAVE-Q08 无显式日期的首次查询与重置保持原页面默认', async () => {
  await draw(0, ''); await wait(() => expect(cache()?.state.status).toBe('success'))
  expect(Object.fromEntries(listRequests().at(-1)!.searchParams)).toEqual(defaultRequest())
  await click('查询'); await wait(() => expect(fields()).toEqual(defaultFields()))
  await click('重置', dialog()); expect(fields()).toEqual(defaultFields())
})
test('WAVE-Q09 真实详情打开关闭仅移除 waveId 并保留所有筛选', async () => {
  respondList = () => listResponse(1); await ready(); const original = path(), before = listRequests().length
  await click('PW-SYN1'); await wait(() => expect(dialog()?.textContent).toContain('批次详情'))
  expect(params()).toEqual({ ...Object.fromEntries(new URLSearchParams(initial)), waveId: '42' })
  await wait(() => expect(requests.some(url => url.pathname === '/api/picking-waves/42')).toBe(true)); await click('关闭', dialog())
  expect(path()).toBe(original); expect(listRequests()).toHaveLength(before); await openQuery(); expect(fields()).toEqual(applied)
})
