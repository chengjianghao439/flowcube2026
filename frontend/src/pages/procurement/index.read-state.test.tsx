// @vitest-environment jsdom
// Real page, query cache, API and collector; only fetch/lookup fixtures.
// All business writes and unknown transport requests are forbidden.
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
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useUserOptions', () => ({ useUserOptions: () => ({ options: [] }), userOptionLabel: () => '' }))
vi.mock('@/components/shared/DatePicker', () => ({ DatePicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input type="date" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

type Spec = { id: 'PLAN' | 'REQ'; path: string; key: string; api: string; code: string; empty: string }
const specs: Spec[] = [
  { id: 'PLAN', path: '/procurement', key: 'procurement-plans', api: '/api/procurement/plans', code: 'PLAN-SYN-', empty: '暂无数据' },
]
const LIST_PATH = "/procurement"

vi.mock('@/router/routeRegistry', async original => ({
  ...await original<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === LIST_PATH ? Page : () => <p>合成详情占位</p>,
}))

let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || !specs.some(spec => spec.api === url.pathname)) {
    unexpected.push(`${method} ${url.pathname}`)
    return failure(403)
  }
  requests.push(url)
  return respond(url)
})
function row(id: number) {
  return { id, code: `PLAN-SYN-${id}`, name: `合成计划${id}`, forecastWindow: 30, horizonDays: 30, itemCount: 1, status: 1, statusName: '草稿', operatorName: '合成生成人', createdAt: '2026-10-14 08:00:00' }
}
function batch(url: URL, total: number) {
  const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 200)
  const from = (page - 1) * pageSize
  return new Response(JSON.stringify({ success: true, data: {
    list: Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, index) => row(from + index + 1)),
    pagination: { page, pageSize, total },
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
function failure(status = 503) {
  return new Response(JSON.stringify({ success: false, code: status === 403 ? 'WAREHOUSE_SCOPE_DENIED' : 'SYNTHETIC_READ_FAILURE', message: status === 403 ? '当前列表范围拒绝' : '合成列表读取中断' }), { status, headers: { 'Content-Type': 'application/json' } })
}
function Harness({ spec }: { spec: Spec }) {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-location>{location.pathname}{location.search}</output><button onClick={() => navigate(getWorkspaceListPath(spec.path.split('?')[0]))}>返回列表</button><KeepAliveOutlet /></>
}
function button(label: string, scope: ParentNode = document.body) {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)
}
async function click(label: string, scope: ParentNode = document.body) {
  const target = button(label, scope); expect(!!target, `button ${label}`).toBe(true)
  await act(async () => target!.click())
}
async function change(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const cache = (spec: Spec) => query.getQueryCache().find({ queryKey: [spec.key], exact: false })
async function wait(assertion: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() })
}
async function mount(spec: Spec) {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[spec.path]}><Harness spec={spec} /></MemoryRouter></QueryClientProvider>))
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); requests.length = 0; unexpected.length = 0; transport.mockClear()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  setApiClientBaseURL('http://plan.fixture.invalid/api')
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-workspace-scroll]')
    const height = this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0
    const top = this === scroll ? 0 : -(scroll?.scrollTop || 0)
    return { height, width: 800, top, left: 0, bottom: top + height, right: 800, x: 0, y: top, toJSON() {} }
  })
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear(); disposeWorkspaceHistoryGuard()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); vi.restoreAllMocks(); vi.unstubAllGlobals()
  expect(unexpected).toEqual([])
})

for (const spec of specs) {
  test(`${spec.id}-R01 first failure is explicit and retryable, never successful emptiness`, async () => {
    respond = () => failure(); await mount(spec); await wait(() => expect(cache(spec)?.state.status).toBe('error'))
    const text = host.textContent || ''
    expect(!!button('重试')).toBe(true); expect(text.includes(spec.empty)).toBe(false)
  })
  test(`${spec.id}-R02 continuation failure rejects the partial batch and keeps a visible retry`, async () => {
    respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 201)
    await mount(spec); await wait(() => expect(cache(spec)?.state.status).toBe('error'))
    expect(requests).toHaveLength(2); expect(cache(spec)?.state.data).toBeUndefined()
    expect(!!button('重试')).toBe(true); expect(host.textContent?.includes(spec.empty)).toBe(false)
  })
  test(`${spec.id}-R03 cached 403 hides old scoped data and old detail navigation`, async () => {
    respond = url => batch(url, 1); await mount(spec); await wait(() => expect(cache(spec)?.state.status).toBe('success'))
    respond = () => failure(403)
    await act(async () => { await query.invalidateQueries({ queryKey: [spec.key] }) })
    await wait(() => expect(cache(spec)?.state.status).toBe('error'))
    const staleRow = host.querySelector('tbody tr')
    const staleVisible = host.textContent?.includes(`${spec.code}1`)
    const detail = spec.id === 'PLAN' ? button('查看', host) : null
    if (detail) await act(async () => detail.click())
    if (spec.id === 'REQ' && staleRow) await act(async () => staleRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(staleVisible).toBe(false); expect(!!staleRow).toBe(false)
  })
  test(`${spec.id}-R04 actual collector completes exactly 5000 without claiming truncation`, async () => {
    respond = url => batch(url, 5000); await mount(spec); await wait(() => expect(cache(spec)?.state.status).toBe('success'))
    const data = cache(spec)?.state.data as { list: unknown[]; truncated: boolean }
    expect(requests).toHaveLength(25); expect(data.list).toHaveLength(5000); expect(data.truncated).toBe(false)
    expect(host.textContent).not.toMatch(/上一页|下一页/)
  }, 20000)
  test(`${spec.id}-R05 actual collector stops at 5000 of 5001 and page discloses incomplete counts`, async () => {
    respond = url => batch(url, 5001); await mount(spec); await wait(() => expect(cache(spec)?.state.status).toBe('success'))
    const data = cache(spec)?.state.data as { list: unknown[]; truncated: boolean }
    expect(requests).toHaveLength(25); expect(data.list).toHaveLength(5000); expect(data.truncated).toBe(true)
    const status = [...host.querySelectorAll('[role="status"]')].map(node => node.textContent).join(' ')
    expect(/5,?000.*5,?001/.test(status) && /缩小|未全部|未取齐|截断/.test(status)).toBe(true)
    expect(host.querySelector('.desktop-page-description')?.textContent).toContain('请缩小查询范围')
    expect(host.querySelectorAll('.desktop-page-description')).toHaveLength(1)
  }, 20000)
  test(`${spec.id}-R06 a successful complete empty response keeps its existing empty view`, async () => {
    respond = url => batch(url, 0); await mount(spec); await wait(() => expect(cache(spec)?.state.status).toBe('success'))
    expect(host.textContent?.includes(spec.empty)).toBe(true); expect(!!button('重试')).toBe(false)
  })
  test(`${spec.id}-R07 real retry retains applied query rather than using a new search draft`, async () => {
    respond = () => failure(); await mount(spec); await wait(() => expect(cache(spec)?.state.status).toBe('error'))
    if (spec.id === 'PLAN') {
      const input = host.querySelector<HTMLInputElement>('input[placeholder="搜索计划编号/名称…"]')!
      await change(input, 'PLAN-APPLIED'); await click('搜索')
      await wait(() => expect(query.getQueryCache().find({ queryKey: [spec.key, 'PLAN-APPLIED'] })?.state.status).toBe('error'))
      await change(input, 'PLAN-UNAPPLIED')
    }
    expect(!!button('重试')).toBe(true)
    respond = url => batch(url, 1); await click('重试')
    await wait(() => expect(host.textContent?.includes(`${spec.code}1`)).toBe(true))
    const params = Object.fromEntries(requests.at(-1)!.searchParams)
    if (spec.id === 'PLAN') { expect(params.keyword).toBe('PLAN-APPLIED'); expect(host.querySelector<HTMLInputElement>('input[placeholder="搜索计划编号/名称…"]')?.value).toBe('PLAN-UNAPPLIED') }
    else expect(params).toMatchObject({ keyword: 'PR-APPLIED', status: '1', warehouseId: '8', applicantId: '7', startDate: '2026-10-01', endDate: '2026-10-14' })
  })
  test.each([200, 503])(`${spec.id}-R08 an open local dialog draft survives a list read settling with %i`, async status => {
    let release!: (response: Response) => void
    respond = () => new Promise(resolve => { release = resolve }); await mount(spec)
    await wait(() => expect(release).toBeTypeOf('function'))
    await click(spec.id === 'PLAN' ? '+ 生成计划' : '查询')
    expect(document.querySelector('.fc-dialog-caption')?.textContent).toContain('已有计划和采购草稿会先行抵扣')
    const selector = spec.id === 'PLAN' ? 'input[placeholder="默认按生成时间"]' : 'input[placeholder="请输入关键字…"]'
    const input = document.querySelector<HTMLInputElement>(`[role="dialog"] ${selector}`)!
    await act(async () => input.focus())
    await change(input, '尚未应用的本地草稿')
    expect(input.value).toBe('尚未应用的本地草稿')
    await act(async () => release(status === 200 ? batch(requests[0], 1) : failure(status)))
    await wait(() => expect(cache(spec)?.state.status).toBe(status === 200 ? 'success' : 'error'))
    expect(input.value).toBe('尚未应用的本地草稿'); expect(document.activeElement).toBe(input)
  })
  test(`${spec.id}-R09 bounded mounting, last-row navigation and return retain the original list query`, async () => {
    respond = url => batch(url, 5000); await mount(spec); await wait(() => expect(cache(spec)?.state.status).toBe('success'))
    expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
    const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
    const firstView = spec.id === 'PLAN' ? button('查看', host)! : null
    if (firstView) await act(async () => firstView.focus())
    await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
    await wait(() => expect(host.textContent?.includes(`${spec.code}5000`)).toBe(true))
    if (firstView) { expect(firstView.isConnected).toBe(true); expect(document.activeElement).toBe(firstView) }
    const last = [...host.querySelectorAll('tbody tr')].find(item => item.textContent?.includes(`${spec.code}5000`))!
    if (spec.id === 'PLAN') await click('查看', last)
    else await act(async () => last.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await wait(() => expect(host.querySelector('[data-location]')?.textContent).toBe(`${spec.path.split('?')[0]}/5000`))
    await click('返回列表')
    await wait(() => expect(host.querySelector('[data-location]')?.textContent?.split('?')[0]).toBe(spec.path.split('?')[0]))
    expect(Object.fromEntries(new URLSearchParams(host.querySelector('[data-location]')!.textContent!.split('?')[1]))).toEqual(Object.fromEntries(new URLSearchParams(spec.path.split('?')[1])))
    expect(scroll.scrollTop).toBeGreaterThan(230000); expect(host.textContent?.includes(`${spec.code}5000`)).toBe(true)
    expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
    expect(requests).toHaveLength(25)
  }, 20000)

}
