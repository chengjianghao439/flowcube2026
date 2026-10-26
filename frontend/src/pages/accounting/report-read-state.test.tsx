// @vitest-environment jsdom
// Real pages, query cache and API client; only the HTTP transport is synthetic.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import ReportsPage from './reports'
import ConsolidationPage from './consolidation'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useCompanyStore } from '@/store/companyStore'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const reads: { path: string; period: string | null; company: string | null }[] = []
const unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const company = { id: 1, code: 'QA_MAIN', name: '合成主账套', isGroup: true, isActive: true }
const balance = { assets: [{ code: '1601', name: '合成固定资产', amount: 100 }, { code: '1602', name: '合成累计折旧', amount: -10 }], liabilities: [{ code: '2202', name: '合成应付', amount: 100 }], equity: [{ code: '——', name: '合成未分配利润', amount: -10 }], assetTotal: 90, liabTotal: 100, equityTotal: -10, liabEquityTotal: 90, balanced: true }
const consolidatedIncome = { companies: [company], revenue: [{ code: '6001', name: '合成汇总收入', amount: 240.45 }], expenses: [], revenueTotal: 240.45, expenseTotal: 0, netProfit: 240.45 }
function response(data: unknown) { return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
function failure(status = 503) { return new Response(JSON.stringify({ success: false, message: '合成报表读取失败', code: 'QA_REPORT_READ_REJECTED' }), { status, headers: { 'Content-Type': 'application/json' } }) }
function success(url: URL) {
  const period = url.searchParams.get('period')
  if (url.pathname.endsWith('/companies')) return response({ list: [company], pagination: { page: 1, pageSize: 50, total: 1 } })
  if (url.pathname.endsWith('/balance-sheet')) return response({ ...balance, period, companies: [company] })
  if (url.pathname.includes('/consolidation/')) return response({ ...consolidatedIncome, period })
  return response({ period, rows: [{ name: '合成报表项目', amount: 91.23 }], profit: 91.23, net: 91.23 })
}
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = typeof input === 'object' && 'url' in input ? input : new Request(input, init)
  const url = new URL(request.url)
  if (request.method === 'GET' && /^\/api\/accounting\/(reports\/(income|balance-sheet|cash-flow)|consolidation\/(income|balance-sheet)|companies)$/.test(url.pathname)) {
    reads.push({ path: url.pathname, period: url.searchParams.get('period'), company: request.headers.get('X-Company-Id') })
    return respond(url)
  }
  unexpected.push(request.method + ' ' + url.pathname)
  return failure(403)
})
function text() {
  const visible = host.cloneNode(true) as HTMLElement
  visible.querySelectorAll('[hidden]').forEach(node => node.remove())
  return visible.textContent || ''
}
function button(name: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => !node.closest('[hidden]') && node.textContent?.trim() === name) }
async function click(name: string) { await act(async () => { const node = button(name); expect(node).toBeTruthy(); node!.click() }) }
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
async function mount(page: 'single' | 'group') {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[page === 'single' ? '/accounting/reports' : '/accounting/consolidation']}>
    {page === 'single' ? <ReportsPage /> : <ConsolidationPage />}
  </MemoryRouter></QueryClientProvider>))
}
async function refresh(prefix: string) { await act(async () => { await query.invalidateQueries({ queryKey: [prefix] }) }) }
const cache = (prefix: string) => query.getQueryCache().find({ queryKey: [prefix], exact: false, type: 'active' })
const singleViews = [
  { label: '利润表', endpoint: 'income', amount: '91.23' },
  { label: '资产负债表', endpoint: 'balance-sheet', amount: '90.00' },
  { label: '现金流量表', endpoint: 'cash-flow', amount: '91.23' },
] as const
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); useCompanyStore.setState({ companyId: 1, companyName: company.name })
  reads.length = 0; unexpected.length = 0; respond = success
  setApiClientBaseURL('http://accounting-report.fixture.invalid/api'); apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 300000, refetchOnWindowFocus: false }, mutations: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  expect(unexpected).toEqual([])
})

test.each(singleViews)('$label 首读失败显示错误并按原期间和账套重试', async view => {
  const path = '/api/accounting/reports/' + view.endpoint
  respond = url => url.pathname === path ? failure() : success(url)
  await mount('single'); await click(view.label)
  await wait(() => expect(text()).toContain(view.label + '加载失败'))
  expect(text()).not.toContain('加载中'); expect(text()).not.toContain(view.amount)
  expect(button('重试')).toBeTruthy()
  const first = reads.filter(read => read.path === path)
  expect(first).toHaveLength(1)
  expect(first[0].company).toBe('1')
  expect(first[0].period).toBe(host.querySelector<HTMLInputElement>('input[placeholder="YYYYMM"]')!.value)
  respond = success; await click('重试')
  await wait(() => expect(text()).toContain(view.amount))
  expect(text()).not.toContain(view.label + '加载失败')
  expect(reads.filter(read => read.path === path)).toEqual([first[0], first[0]])
})

test.each(singleViews)('$label 缓存后刷新失败隐藏旧数值，重试进行中不重复发送', async view => {
  const path = '/api/accounting/reports/' + view.endpoint
  await mount('single'); await click(view.label); await wait(() => expect(text()).toContain(view.amount))
  respond = url => url.pathname === path ? failure(403) : success(url)
  await refresh('acct-ledger'); await wait(() => expect(text()).toContain(view.label + '加载失败'))
  expect(text()).not.toContain(view.amount)
  let release!: (value: Response) => void
  respond = url => url.pathname === path ? new Promise<Response>(resolve => { release = resolve }) : success(url)
  await click('重试')
  await wait(() => expect(text()).toContain('加载中'))
  expect(text()).not.toContain(view.amount); expect(button('重试')).toBeUndefined()
  const currentReads = reads.filter(read => read.path === path)
  expect(currentReads).toHaveLength(3)
  await act(async () => release(success(new URL('http://fixture.invalid' + path))))
  await wait(() => expect(text()).toContain(view.amount))
})

test('单体成功空期仍显示真实零值与会计等式', async () => {
  respond = url => url.pathname.endsWith('/balance-sheet') ? response({ ...balance, assets: [], liabilities: [], equity: [], assetTotal: 0, liabTotal: 0, equityTotal: 0, liabEquityTotal: 0 }) : success(url)
  await mount('single'); await click('资产负债表'); await wait(() => expect(text()).toContain('会计等式成立'))
  expect(text()).toContain('0.00'); expect(text()).not.toContain('加载失败'); expect(button('重试')).toBeUndefined()
})

const groupViews = [
  { label: '合并资产负债表', endpoint: 'balance-sheet', prefix: 'consol-bs', amount: '90.00', hidden: '资产合计', sibling: '240.45' },
  { label: '合并利润表', endpoint: 'income', prefix: 'consol-inc', amount: '240.45', hidden: '净利润', sibling: '90.00' },
] as const
test.each(groupViews)('$label 首读失败不显示默认零值，其余报表可用，重试只请求失败项', async view => {
  const path = '/api/accounting/consolidation/' + view.endpoint
  respond = url => url.pathname === path ? failure() : success(url)
  await mount('group'); await wait(() => expect(text()).toContain(view.label + '加载失败'))
  await wait(() => expect(text()).toContain(view.sibling))
  expect(text()).not.toContain(view.hidden); expect(text()).not.toContain('不平！')
  const before = [...reads]
  respond = success; await click('重试'); await wait(() => expect(text()).toContain(view.hidden))
  expect(text()).toContain(view.amount)
  expect(reads.slice(before.length)).toEqual(before.filter(read => read.path === path))
})

test.each(groupViews)('$label 缓存后失败隐藏旧金额，再次读取期间显示加载并恢复', async view => {
  const path = '/api/accounting/consolidation/' + view.endpoint
  await mount('group'); await wait(() => expect(text()).toContain(view.amount))
  respond = url => url.pathname === path ? failure() : success(url)
  await refresh(view.prefix); await wait(() => expect(cache(view.prefix)?.state.status).toBe('error'))
  await wait(() => expect(text()).toContain(view.label + '加载失败'))
  expect(cache(view.prefix)?.state.data).toBeTruthy(); expect(text()).not.toContain(view.hidden); expect(text()).not.toContain(view.amount)
  let release!: (value: Response) => void
  respond = url => url.pathname === path ? new Promise<Response>(resolve => { release = resolve }) : success(url)
  await click('重试'); await wait(() => expect(text()).toContain(view.label + '加载中'))
  expect(text()).not.toContain(view.hidden); expect(button('重试')).toBeUndefined()
  await act(async () => release(success(new URL('http://fixture.invalid' + path))))
  await wait(() => expect(text()).toContain(view.hidden))
})

test('汇总初始加载期间不呈现零报表或不平结论', async () => {
  const releases: (() => void)[] = []
  respond = url => url.pathname.includes('/consolidation/') ? new Promise<Response>(resolve => { releases.push(() => resolve(success(url))) }) : success(url)
  await mount('group'); await wait(() => expect(releases).toHaveLength(2))
  expect(text()).toContain('合并资产负债表加载中'); expect(text()).toContain('合并利润表加载中')
  expect(text()).not.toMatch(/资产合计|净利润|不平！/)
  await act(async () => releases.forEach(release => release()))
  await wait(() => expect(text()).toContain('资产合计'))
})

test('账套列表读取失败可重试，不能永久停在表格加载', async () => {
  respond = url => url.pathname.endsWith('/companies') ? failure() : success(url)
  await mount('group'); await wait(() => expect(text()).toContain('账套列表加载失败'))
  respond = success; await click('重试'); await wait(() => expect(text()).toContain('合成主账套'))
  expect(reads.filter(read => read.path.endsWith('/companies'))).toHaveLength(2)
})

test('期间和账套切换后，失败及重试沿当前条件，不回到旧查询', async () => {
  respond = url => url.pathname.endsWith('/balance-sheet') ? failure() : success(url)
  await mount('single'); await click('资产负债表'); await wait(() => expect(text()).toContain('资产负债表加载失败'))
  await act(async () => useCompanyStore.setState({ companyId: 2, companyName: '合成子账套' }))
  const input = host.querySelector<HTMLInputElement>('input[placeholder="YYYYMM"]')!
  const user = userEvent.setup()
  await act(async () => { await user.clear(input); await user.type(input, '202611') })
  await wait(() => expect(reads.at(-1)).toMatchObject({ path: '/api/accounting/reports/balance-sheet', period: '202611', company: '2' }))
  await wait(() => expect(text()).toContain('资产负债表加载失败'))
  respond = success; await click('重试'); await wait(() => expect(text()).toContain('会计等式成立'))
  expect(input.value).toBe('202611')
  expect(reads.at(-1)).toMatchObject({ path: '/api/accounting/reports/balance-sheet', period: '202611', company: '2' })
})

test('汇总成功空期显示真实零值和平衡，保留空态', async () => {
  respond = url => url.pathname.endsWith('/balance-sheet') ? response({ ...balance, assets: [], liabilities: [], equity: [], assetTotal: 0, liabTotal: 0, equityTotal: 0, liabEquityTotal: 0 }) : success(url)
  await mount('group'); await wait(() => expect(text()).toContain('资产合计'))
  expect(text()).toContain('¥0.00'); expect(text()).toContain('平衡')
  expect(text()).not.toContain('不平！'); expect(text()).not.toContain('加载失败')
})
