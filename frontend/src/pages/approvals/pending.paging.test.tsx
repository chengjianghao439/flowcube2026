// @vitest-environment jsdom
// Real page/hook/API/identity collector; only closed synthetic fetch and geometry.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './pending'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import type { PaginatedData } from '@/types'
import type { PendingApproval } from '@/types/approval'

let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
function failure(status = 500) { return json({ success: false, message: '合成审批读取失败', code: status === 403 ? 'WAREHOUSE_SCOPE_DENIED' : 'SYNTHETIC_READ_FAILURE' }, status) }
const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || url.pathname !== '/api/approvals/pending') { unexpected.push(`${method} ${url.pathname}`); return failure(403) }
  requests.push(url); return respond(url)
}
function row(id: number): PendingApproval { return { sourceKind: 'engine', entryKey: `engine:sale_credit_override:${id}:1:${id}`, instanceId: id, taskId: id, flowId: 1, currentStep: 1, bizType: 'sale_credit_override', bizId: id, no: `SYN-AP-${id}`, title: '合成审批', status: 2, applicantId: 3, applicantName: '合成申请人', amount: 12.34, createdAt: '2026-10-15 08:00:00' } }
function batch(url: URL, total: number) {
  const page = Number(url.searchParams.get('page') || 1)
  // Current approvals backend caps each response at100, including requested200.
  const pageSize = Math.min(100, Number(url.searchParams.get('pageSize') || 20)), start = (page - 1) * pageSize
  return json({ success: true, data: { list: Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, index) => row(start + index + 1)), pagination: { page, pageSize, total } } })
}
function Harness() { const location = useLocation(); return <><output data-location>{location.pathname}{location.search}</output><TabPathContext.Provider value="/approvals/pending"><div data-workspace-scroll style={{ height: 480, overflow: 'auto' }}><Page /></div></TabPathContext.Provider></> }
function button(label: string, scope: ParentNode = host) { return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label) }
async function click(label: string, scope: ParentNode = host) { const target = button(label, scope); expect(target, label).toBeTruthy(); await act(async () => target!.click()) }
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
const cached = () => query.getQueryCache().find({ queryKey: ['approval-pending'], exact: false })
const data = () => cached()?.state.data as PaginatedData<PendingApproval> | undefined
async function mount() { await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={['/approvals/pending']}><Harness /></MemoryRouter></QueryClientProvider>)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear(); requests.length = 0; unexpected.length = 0
  setApiClientBaseURL('http://approval-paging.fixture.invalid/api')
  useAuthStore.getState().login('synthetic', null, { id: 9, username: 'synthetic', realName: '合成员工', roleId: 2, roleName: '合成角色', permissions: [P.APPROVAL_TASK_VIEW, P.SALE_CREDIT_OVERRIDE_VIEW] })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-workspace-scroll]'), height = this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0, top = this === scroll ? 0 : -(scroll?.scrollTop || 0)
    return { height, width: 800, top, left: 0, bottom: top + height, right: 800, x: 0, y: top, toJSON() {} }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); vi.restoreAllMocks(); vi.unstubAllGlobals()
  expect(unexpected).toEqual([])
})

test('21条待办自动读取并可达末条，不要求员工翻页', async () => {
  respond = url => batch(url, 21); await mount(); await wait(() => expect(cached()?.state.status).toBe('success'))
  expect(data()?.list).toHaveLength(21)
  expect(host.textContent).toContain('SYN-AP-21')
  expect(host.textContent).not.toMatch(/上一页|下一页|第 \d+ \/ \d+ 页/)
})
test.each([5000, 5001])('真实有界读取%i并明确完整/截断数量', async total => {
  respond = url => batch(url, total); await mount(); await wait(() => expect(cached()?.state.status).toBe('success'))
  expect(data()?.list).toHaveLength(5000); expect(data()?.truncated).toBe(total > 5000)
  expect(requests).toHaveLength(50)
  const status = [...host.querySelectorAll('[role="status"]')].map(node => node.textContent).join(' ')
  if (total > 5000) { expect(/5,?000.*5,?001/.test(status) && /仅显示|未全部|未完整|截断/.test(status)).toBe(true); expect(host.querySelector('.desktop-page-description')?.textContent).toContain('待办未全部读取') }
  else expect(status).toContain('5,000')
  expect(host.textContent).not.toMatch(/上一页|下一页/)
}, 15000)
test('真实虚拟表挂载有界，末条原单导航保留既有查询并保留聚焦行', async () => {
  respond = url => batch(url, 5000); await mount(); await wait(() => expect(cached()?.state.status).toBe('success'))
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  const first = button('去审批')!; await act(async () => first.focus())
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  await wait(() => expect(host.textContent).toContain('SYN-AP-5000'))
  expect(first.isConnected).toBe(true); expect(document.activeElement).toBe(first)
  useWorkspaceStore.getState().addTab({ key: '/credit-overrides', path: '/credit-overrides?keyword=保留条件&status=2&detailId=1', title: '超额放行申请' })
  await click('SYN-AP-5000')
  const target = new URL(`https://synthetic.invalid${host.querySelector('[data-location]')!.textContent}`)
  expect(target.pathname).toBe('/credit-overrides'); expect(target.searchParams.get('detailId')).toBe('5000')
  expect(target.searchParams.get('keyword')).toBe('保留条件'); expect(target.searchParams.get('status')).toBe('2')
}, 15000)
test('续批500拒绝部分待办，原查询重试从首批恢复', async () => {
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 101)
  await mount(); await wait(() => expect(cached()?.state.status).toBe('error'))
  expect(requests).toHaveLength(2); expect(data()).toBeUndefined()
  expect(host.textContent).not.toContain('SYN-AP-1')
  expect(host.textContent).toContain('审批待办读取失败')
  respond = url => batch(url, 101); await click('重试')
  await wait(() => expect(data()?.list).toHaveLength(101))
  expect(requests[2].searchParams.get('page')).toBe('1')
})
test.each([500, 403])('缓存%i失败隐藏旧待办和旧成功数量，不展示空表成功', async status => {
  respond = url => batch(url, 2); await mount(); await wait(() => expect(host.textContent).toContain('SYN-AP-1'))
  respond = () => failure(status)
  await act(async () => { await query.invalidateQueries({ queryKey: ['approval-pending'] }) })
  await wait(() => expect(cached()?.state.status).toBe('error'))
  expect(host.textContent).not.toContain('SYN-AP-1')
  expect([...host.querySelectorAll('[role="status"]')].map(node => node.textContent).join(' ')).not.toContain('共 2 条')
  expect(host.textContent).not.toContain('没有待你审批的单据')
})
