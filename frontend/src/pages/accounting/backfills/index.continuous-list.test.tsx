// @vitest-environment jsdom
// Actual page, API, query cache, collector, virtual table, focus and detail dialogs.
// Only synthetic GET responses and deterministic DOM geometry; no business writes.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './index'
import api, { getApiClientBaseURL, setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useCompanyStore } from '@/store/companyStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { TabPathContext } from '@/components/layout/TabPathContext'
import KeepAliveSection from '@/components/shared/KeepAliveSection'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
const spec = { path: '/accounting/backfills', api: '/api/accounting/backfills', key: 'acct-backfills', code: 'BF-SYN-', title: '跨期补录审批', backfill: true }
let host: HTMLDivElement, root: Root, cache: QueryClient
let total = 1, failedPage = 0, driftPage = 0
let pendingSecond: Promise<Response> | null = null, pendingFirst: Promise<Response> | null = null
const requestSignals: (AbortSignal | undefined)[] = []
const requests: { url: URL; company: string | null; auth: string | null }[] = [], unexpected: string[] = []
const oldAdapter = api.defaults.adapter, oldEnv = api.defaults.env, oldBase = getApiClientBaseURL()
const oldScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const oldScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
function row(id: number) { return { id, applicationNo: `BF-SYN-${id}`, period: '202609', businessDate: '2026-09-30', bizType: 'refund', bizTypeName: '退款出账', bizId: id, bizNo: `RF-SOURCE-${id}`, amount: 100, reason: '合成核对原因', status: 1, statusName: '已记账', applicantId: 9, applicantName: '合成申请人', approverId: 10, approverName: '合成审批人', approvedAt: '2026-10-01', approveRemark: null, executedAt: '2026-10-01', executedBizId: id, postingPeriod: '202610', voucherGeneratedAt: '2026-10-01', voucherGenerateError: null, voidReason: null, voidedBy: null, voidedByName: null, voidedAt: null, createdAt: '2026-10-01', pendingExecution: false, voidableByApplicant: false, voidable: false, replayFailed: false, voucherPending: false, voucherNotRequired: false, requestSnapshot: { kind: 'refund', body: { accountId: 42, amount: 100, refundDate: '2026-09-30', saleOrderNo: 'SO-SYN', customerName: '合成客户' } } } }
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { success: true, data } : { success: false, code: 'SYNTHETIC_LIST_READ_FAILURE', message: '合成连续读取失败' }), { status, headers: { 'Content-Type': 'application/json' } })
}
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET') { unexpected.push(`${method} ${url.pathname}`); throw Error('分页回归禁止业务写入') }
  if (url.pathname === spec.api) {
    const headers = typeof input === 'object' && 'headers' in input ? input.headers : new Headers(init?.headers)
    requests.push({ url, company: headers.get('X-Company-Id'), auth: headers.get('Authorization') })
    requestSignals.push(typeof input === 'object' && 'signal' in input ? input.signal : init?.signal ?? undefined)
    const rawPage = url.searchParams.get('page') ?? '1', rawSize = url.searchParams.get('pageSize') ?? '20'
    // Match actual service: backfills clamps to 200; supplier refunds validates and rejects >200.
    const page = spec.backfill ? Math.max(Number(rawPage) || 1, 1) : Number(rawPage)
    const pageSize = spec.backfill ? Math.min(Math.max(Number(rawSize) || 20, 1), 200) : Number(rawSize)
    if (!spec.backfill && (!/^[1-9]\d*$/.test(rawPage) || !/^[1-9]\d*$/.test(rawSize) || !Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > 200 || !Number.isSafeInteger((page - 1) * pageSize))) return response(null, 400)
    if (page === 1 && pendingFirst) return pendingFirst
    if (page === failedPage) return response(null, 503)
    if (page === 2 && pendingSecond) return pendingSecond
    const from = (page - 1) * pageSize
    const list = Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => row(from + i + 1))
    const count = page === driftPage ? total + 1 : total
    return response(spec.backfill
      ? { list, pagination: { page, pageSize, total: count }, summary: { total: count, pending: 0, pendingExecution: 0, voucherPending: 0 } }
      : { list, page, pageSize, total: count })
  }
  if (url.pathname === '/api/finance/accounts/active') return response([{ id: 42, name: '合成原收入账户' }])
  if (url.pathname === '/api/warehouses/active') return response([{ id: 8, name: '合成仓库' }])
  const detail = new RegExp(`^${spec.api}/([1-9][0-9]*)$`).exec(url.pathname)
  if (detail) return response(row(Number(detail[1])))
  unexpected.push(`${method} ${url.pathname}`)
  throw Error(`分页回归禁止未声明端点：${url.pathname}`)
})
const query = () => cache.getQueryCache().findAll({ queryKey: [spec.key], type: 'active' }).find(q => !q.queryKey.includes('detail'))!
const data = () => query().state.data as { list: { id: number }[]; pagination?: { total: number }; total?: number; truncated?: boolean } | undefined
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function wait(check: () => void) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await flush()
    try { check(); return } catch (error) { if (attempt === 99) throw error }
  }
}
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)
async function click(text: string, scope: ParentNode = host) {
  const node = button(text, scope); expect(node, text).toBeTruthy()
  await act(async () => node!.click()); await flush()
}
async function draw(active = true) {
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[spec.path]}>
    <TabPathContext.Provider value={spec.path}><KeepAliveSection active={active}><div data-workspace-scroll><Page /></div></KeepAliveSection></TabPathContext.Provider>
  </MemoryRouter></QueryClientProvider>)); await flush()
}
async function loaded() { await wait(() => expect(query()?.state.status).toBe('success')) }
const code = (id: number) => `${spec.code}${id}`
const actualRows = () => host.querySelectorAll('tbody tr:not([aria-hidden])')
function findRow(id: number) { return [...actualRows()].find(node => node.textContent?.includes(code(id)))! }
function detailTrigger(id: number) { return button(spec.backfill ? '详情' : code(id), findRow(id))! }
async function chooseBizType(label: string) {
  const trigger = host.querySelectorAll<HTMLElement>('[role="combobox"]')[1]
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  await flush()
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === label)!
  expect(option).toBeTruthy()
  await act(async () => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await flush()
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); total = 1; failedPage = 0; driftPage = 0; pendingSecond = null; pendingFirst = null; requestSignals.length = 0; requests.length = 0; unexpected.length = 0
  setApiClientBaseURL('http://finance-pages.test/api'); useCompanyStore.setState({ companyId: 1 })
  useAuthStore.getState().login('paging-fixture', null, { id: 10, username: 'fixture', realName: '合成人员', roleId: 2, roleName: 'fixture', permissions: ['finance.period.backfill.approve', 'supplier.refund.view', 'supplier.refund.receive', 'purchase.order.view', 'return.order.view', 'payment.view', 'finance.account.view'] })
  useWorkspaceStore.setState({ tabs: [HOME_TAB, { key: spec.path, path: spec.path, title: spec.title, closable: true }], activeKey: spec.path })
  api.defaults.adapter = 'fetch'; api.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn() })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-workspace-scroll]'), height = this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0
    const top = this === scroll ? 0 : -(scroll?.scrollTop || 0)
    return { height, width: 800, top, left: 0, bottom: top + height, right: 800, x: 0, y: top, toJSON() {} }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); cache.clear(); host.remove()
  api.defaults.adapter = oldAdapter; api.defaults.env = oldEnv; setApiClientBaseURL(oldBase)
  useAuthStore.setState({ user: null, token: null }); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); localStorage.clear()
  if (oldScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', oldScrollIntoView); else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  if (oldScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', oldScrollTo); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  expect(unexpected).toEqual([])
})

test('201条通过真实API自动200批取齐，不提供可见分页，末批身份/账套保持', async () => {
  total = 201; await draw(); await loaded()
  expect(data()?.list).toHaveLength(201)
  expect(requests.map(r => [Number(r.url.searchParams.get('page')), Number(r.url.searchParams.get('pageSize'))])).toEqual([[1, 200], [2, 200]])
  expect(button('上一页')).toBeUndefined(); expect(button('下一页')).toBeUndefined()
  expect(host.textContent).not.toMatch(/第\s*\d+\s*\/\s*\d+\s*页/)
  expect(requests.every(r => r.auth === 'Bearer paging-fixture')).toBe(true)
  if (spec.backfill) expect(requests.every(r => r.company === '1')).toBe(true)
})

test.each([5000, 5001])('%i匹配最多读取5000，真实collector标记与页面数量一致', async count => {
  total = count; await draw(); await loaded()
  expect(data()?.list).toHaveLength(5000)
  expect(requests).toHaveLength(25)
  expect(requests.every(r => Number(r.url.searchParams.get('pageSize')) === 200)).toBe(true)
  expect(data()?.truncated).toBe(count === 5001)
  const text = host.textContent!.replace(/[,\s]/g, '')
  if (count === 5001) { expect(host.querySelector('.desktop-page-description')?.textContent).toContain('请缩小查询范围'); expect(host.querySelectorAll('.desktop-page-description')).toHaveLength(1); expect(text).toContain('已加载5000'); expect(text).toContain('匹配5001'); expect(text).toContain('缩小查询范围') }
  else { expect(text).toContain('共5000'); expect(text).not.toContain('缩小查询范围') }
})

test.each(['failure', 'drift'])('第二批%s拒绝残缺成功、旧计数与行入口，重试从原首批开始', async kind => {
  total = 201; if (kind === 'failure') failedPage = 2; else driftPage = 2
  await draw(); await wait(() => expect(query()?.state.status).toBe('error'))
  expect(data()).toBeUndefined(); expect(actualRows()).toHaveLength(0)
  expect(host.textContent).not.toContain('共 201'); expect(button('重试')).toBeTruthy()
  failedPage = 0; driftPage = 0; const before = requests.length
  await click('重试'); await loaded()
  expect(requests.slice(before).map(r => Number(r.url.searchParams.get('page')))).toEqual([1, 2])
  expect(data()?.list).toHaveLength(201)
})

test('缓存后读取失败隐藏旧表和成功数量，原条件恢复完整结果', async () => {
  await draw(); await loaded(); expect(host.textContent).toContain(code(1))
  failedPage = 1
  await act(async () => { await cache.refetchQueries({ queryKey: [spec.key] }) }); await flush()
  expect(query().state.status).toBe('error')
  expect(host.textContent).not.toContain(code(1)); expect(button('重试')).toBeTruthy()
  expect(host.querySelector('[role="status"]')).toBeNull()
  failedPage = 0; await click('重试'); await loaded(); expect(host.textContent).toContain(code(1))
})

test('虚拟表有界挂载，末行详情准确且关闭回焦原行，列表仍保完整数据', async () => {
  total = 5000; await draw(); await loaded()
  expect(host.querySelector('[data-virtual-body]')).toBeTruthy()
  expect(actualRows().length).toBeLessThan(50)
  const first = detailTrigger(1), scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => first.focus())
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  await wait(() => expect(findRow(5000)).toBeTruthy())
  expect(first.isConnected).toBe(true); expect(document.activeElement).toBe(first)
  const last = detailTrigger(5000)
  await act(async () => { last.focus(); last.click() }); await flush()
  await wait(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain(code(5000)))
  const modal = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(modal.textContent).toContain('2026-09-30')
  expect(modal.textContent).toContain(spec.backfill ? '合成原收入账户' : '原账户 #42')
  if (!spec.backfill) expect(modal.textContent).toContain('登记实际已收到')
  await act(async () => { scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')) }); await flush()
  expect(last.isConnected).toBe(true)
  await click('关闭', modal)
  expect(document.activeElement).toBe(last); expect(last.isConnected).toBe(true)
  expect(data()?.list).toHaveLength(5000); expect(requests).toHaveLength(25)
  expect(actualRows().length).toBeLessThan(50)
}, 15000)

if (spec.backfill) test('业务筛选沿原值传每批，详情关闭与刷新不清筛选', async () => {
  total = 201; await draw(); await loaded(); requests.length = 0
  await chooseBizType('供应商退款'); await loaded()
  expect(requests.map(r => r.url.searchParams.get('bizType'))).toEqual(['supplier_refund', 'supplier_refund'])
  const trigger = detailTrigger(1); await act(async () => { trigger.focus(); trigger.click() }); await flush()
  const modal = document.querySelector<HTMLElement>('[role="dialog"]')!; await click('关闭', modal)
  expect(host.querySelectorAll('[role="combobox"]')[1].textContent).toContain('供应商退款')
  await click('刷新'); await loaded()
  expect(requests.every(r => r.url.searchParams.get('bizType') === 'supplier_refund')).toBe(true)
})

test('读取续批前活动上下文改变不继续发送旧范围后续批，不接受残缺结果', async () => {
  let release!: (value: Response) => void
  total = 401; pendingSecond = new Promise(resolve => { release = resolve })
  await draw(); await wait(() => expect(requests.some(r => r.url.searchParams.get('page') === '2')).toBe(true))
  await draw(false)
  await act(async () => release(response(spec.backfill
    ? { list: Array.from({ length: 200 }, (_, i) => row(201 + i)), pagination: { page: 2, pageSize: 200, total }, summary: { total, pending: 0, pendingExecution: 0, voucherPending: 0 } }
    : { list: Array.from({ length: 200 }, (_, i) => row(201 + i)), page: 2, pageSize: 200, total })))
  await flush(); await flush()
  expect(requests.some(r => r.url.searchParams.get('page') === '3')).toBe(false)
  expect(host.textContent).not.toContain(code(201))
})


test.each(['隐藏', '卸载'])('首批在途%s会取消订阅与信号，迟到完成不续批，恢复从首批重读', async mode => {
  let release!: (value: Response) => void
  total = 201; pendingFirst = new Promise(resolve => { release = resolve })
  await draw(); await wait(() => expect(requests).toHaveLength(1))
  const firstSignal = requestSignals[0]
  if (mode === '隐藏') await draw(false)
  else await act(async () => root.render(null))
  const list = Array.from({ length: 200 }, (_, i) => row(i + 1))
  // The synthetic transport deliberately resolves late even when its signal is aborted.
  await act(async () => release(response(spec.backfill
    ? { list, pagination: { page: 1, pageSize: 200, total }, summary: { total, pending: 0, pendingExecution: 0, voucherPending: 0 } }
    : { list, page: 1, pageSize: 200, total })))
  await flush(); await flush()
  expect(requests.map(r => Number(r.url.searchParams.get('page')))).toEqual([1])
  expect(firstSignal?.aborted).toBe(true)
  expect(cache.getQueryCache().findAll({ queryKey: [spec.key] }).every(q => q.state.data === undefined)).toBe(true)
  pendingFirst = null; await draw(); await loaded()
  expect(requests.map(r => Number(r.url.searchParams.get('page')))).toEqual([1, 1, 2])
  expect(data()?.list).toHaveLength(201)
})
