// @vitest-environment jsdom
// Real page, QueryDialog, DatePicker, QueryClient, hooks, API and list collector.
// Synthetic fetch is a closed GET allowlist; no business or network writes.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './index'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import api, { getApiClientBaseURL, setApiClientBaseURL } from '@/api/client'

const grants = vi.hoisted(() => new Set<string>())
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => grants.has(code) }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

const spec = { path: '/credit-overrides?keyword=URL-APPLIED&status=2&startDate=2026-10-01&endDate=2026-10-15&keep=1', api: '/api/credit-overrides', key: 'credit-overrides', urlFilters: true }
let host: HTMLDivElement, root: Root, cache: QueryClient
let currentSearch = '', version = 1, failRead = false
let approvalRow = false, backendCanApprove = true
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = api.defaults.adapter, oldEnv = api.defaults.env, oldBase = getApiClientBaseURL()
const oldScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || ![spec.api, '/api/finance/accounts/active'].includes(url.pathname)) {
    unexpected.push(`${method} ${url.pathname}`)
    throw new Error('查询草稿回归禁止未授权端点与写入')
  }
  requests.push(url)
  const data = url.pathname === '/api/finance/accounts/active' ? [] : {
    list: [{ id: 1, overrideNo: `CO-SYN-${version}`, saleOrderId: 10, saleOrderNo: 'SO-SYN', customerId: 11, customerName: '合成客户', creditLimit: 100, usedCredit: 90, thisAmount: 20, overAmount: 10, reason: '合成原因', applicantId: 1, applicantName: '合成申请人', status: approvalRow ? 2 : 3, statusName: approvalRow ? '待审批' : '已批准', statusTone: 'success', canApprove: backendCanApprove, currentTaskId: 91, canManage: false, rejectReason: null, createdAt: '2026-10-15T02:00:00Z' }],
    pagination: { page: 1, pageSize: 200, total: 1 },
  }
  const failed = failRead && url.pathname === spec.api
  return new Response(JSON.stringify(failed ? { success: false, code: 'SYNTHETIC_READ_FAILURE', message: '合成后台读取失败' } : { success: true, data }), {
    status: failed ? 503 : 200, headers: { 'Content-Type': 'application/json' },
  })
})
function LocationProbe() { currentSearch = useLocation().search; return null }
function Frame({ active, tick }: { active: boolean; tick: number }) {
  return <><output data-parent-tick>{tick}</output><LocationProbe /><KeepAliveSection active={active}><Page /></KeepAliveSection></>
}
async function draw(active = true, tick = 0) {
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[spec.path]}>
    <Frame active={active} tick={tick} />
  </MemoryRouter></QueryClientProvider>))
  await flush()
}
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }

test.each([
  { permission: 'sale.credit.override.approve', qualified: true, apply: false, approve: true },
  { permission: 'sale.credit.override.apply', qualified: true, apply: true, approve: false },
  { permission: 'sale.credit.override.approve', qualified: false, apply: false, approve: false },
])('申请和审批按钮按独立权限及后台资格显示：$permission，资格=$qualified', async ({ permission, qualified, apply, approve }) => {
  grants.add(permission); approvalRow = true; backendCanApprove = qualified
  await draw()
  await vi.waitFor(async () => { await flush(); expect(query().state.status).toBe('success') })
  const buttons = () => [...host.querySelectorAll('button')].map(node => node.textContent?.trim())
  expect(buttons().includes('发起申请')).toBe(apply)
  expect(buttons().includes('批准')).toBe(approve)
  expect(buttons().includes('驳回')).toBe(approve)
})
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const keyword = () => dialog().querySelector<HTMLInputElement>('[placeholder="请输入关键字…"]')!
const dates = () => [...dialog().querySelectorAll<HTMLInputElement>('[placeholder="yyyy-mm-dd"]')]
const listRequests = () => requests.filter(url => url.pathname === spec.api)
const lastParams = () => Object.fromEntries(listRequests().at(-1)!.searchParams)
const query = () => cache.getQueryCache().findAll({ queryKey: [spec.key], type: 'active' })[0]
async function click(label: string, scope: ParentNode = host) {
  const target = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)
  expect(target, label).toBeTruthy()
  await act(async () => target!.click()); await flush()
}
async function input(node: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function date(index: number, value: string) {
  const node = dates()[index]
  await input(node, value)
  await act(async () => node.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
}
async function seedApplied() {
  await draw()
  await vi.waitFor(async () => { await flush(); expect(query().state.status).toBe('success') })
  await click('查询')
  await input(keyword(), 'APPLIED')
  await date(0, '2026-10-01'); await date(1, '2026-10-15')
  await click('查询', dialog())
  expect(lastParams()).toMatchObject({ keyword: 'APPLIED', startDate: '2026-10-01', endDate: '2026-10-15' })
  expect(host.textContent).toContain('APPLIED')
}
async function draft() {
  await click('查询')
  await input(keyword(), 'UNAPPLIED-DRAFT')
  await date(0, '2026-10-04'); await date(1, '2026-10-12')
}
function assertDraft() {
  expect(keyword().value).toBe('UNAPPLIED-DRAFT')
  expect(dates().map(node => node.value)).toEqual(['2026-10-04', '2026-10-12'])
}
async function refresh(failed = false) {
  version++; failRead = failed
  await act(async () => { await cache.invalidateQueries({ queryKey: [spec.key] }) }); await flush()
  expect(query().state.status).toBe(failed ? 'error' : 'success')
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); requests.length = 0; unexpected.length = 0; transport.mockClear(); version = 1; failRead = false
  grants.clear(); approvalRow = false; backendCanApprove = true
  setApiClientBaseURL('http://query-drafts.test/api')
  api.defaults.adapter = 'fetch'; api.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() })
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  cache.clear(); host.remove(); api.defaults.adapter = oldAdapter; api.defaults.env = oldEnv; setApiClientBaseURL(oldBase)
  if (oldScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', oldScroll)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear()
  expect(unexpected).toEqual([])
  expect(transport).toHaveBeenCalled()
})

test.each([false, true])('后台GET失败=%s 时保留未应用关键字和日期，不改已应用条件', async failed => {
  await seedApplied(); const applied = lastParams(), search = currentSearch
  await draft(); assertDraft()
  await refresh(failed)
  expect(lastParams()).toEqual(applied)
  expect(currentSearch).toBe(search)
  assertDraft()
})

test('父级重渲染保留尚未应用输入，不触发新查询', async () => {
  await seedApplied(); await draft(); const count = listRequests().length
  await draw(true, 1)
  assertDraft()
  expect(listRequests()).toHaveLength(count)
})

test('隐藏页签时浮层隐藏，返回仍是原未应用输入与原查询', async () => {
  await seedApplied(); await draft(); const search = currentSearch
  await draw(false, 1)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await refresh()
  await draw(true, 2)
  assertDraft()
  expect(currentSearch).toBe(search)
  expect(lastParams().keyword).toBe('APPLIED')
})

test('取消不应用草稿，重新打开加载原已应用值', async () => {
  await seedApplied(); const applied = lastParams(), search = currentSearch
  await draft(); await click('取消', dialog())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(lastParams()).toEqual(applied); expect(currentSearch).toBe(search)
  await click('查询')
  expect(keyword().value).toBe('APPLIED')
  expect(dates().map(node => node.value)).toEqual(['2026-10-01', '2026-10-15'])
})

test('重置只清本次草稿，后台刷新不回填；点击查询才应用原空默认值', async () => {
  await seedApplied(); const applied = lastParams(), search = currentSearch
  await draft(); await click('重置', dialog())
  expect(keyword().value).toBe('')
  expect(dates().map(node => node.value)).toEqual(['', ''])
  expect(dialog().querySelector('[role="combobox"]')?.textContent).toContain('全部状态')
  expect(lastParams()).toEqual(applied); expect(currentSearch).toBe(search)
  await refresh()
  expect(keyword().value).toBe('')
  expect(dates().map(node => node.value)).toEqual(['', ''])
  await click('查询', dialog())
  expect(lastParams().keyword || '').toBe('')
  expect(lastParams().startDate || '').toBe(''); expect(lastParams().endDate || '').toBe('')
  if (spec.urlFilters) {
    const params = new URLSearchParams(currentSearch)
    for (const name of ['keyword', 'status', 'startDate', 'endDate']) expect(params.has(name)).toBe(false)
    expect(params.get('keep')).toBe('1')
  } else expect(currentSearch).toBe(search)
})

test('查询应用当前草稿并重读，重开沿最新应用值及本页原URL合同', async () => {
  await seedApplied(); const search = currentSearch
  await draft(); await click('查询', dialog())
  expect(lastParams()).toMatchObject({ keyword: 'UNAPPLIED-DRAFT', startDate: '2026-10-04', endDate: '2026-10-12' })
  if (spec.urlFilters) {
    const params = new URLSearchParams(currentSearch)
    expect(params.get('keyword')).toBe('UNAPPLIED-DRAFT')
    expect(params.get('startDate')).toBe('2026-10-04'); expect(params.get('endDate')).toBe('2026-10-12')
    expect(params.get('status')).toBe('2'); expect(params.get('keep')).toBe('1')
  } else expect(currentSearch).toBe(search)
  await click('查询')
  assertDraft()
})
