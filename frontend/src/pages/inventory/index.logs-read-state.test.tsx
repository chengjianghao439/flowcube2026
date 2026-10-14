// @vitest-environment jsdom
// Production page, query dialog, useLogs, payload client and bounded collector.
// Only transport fetch responses and unrelated UI/data dependencies are synthetic.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import InventoryPage from './index'
import apiClient, { setApiClientBaseURL } from '@/api/client'

vi.mock('@/hooks/useInventory', async original => ({ ...await original<typeof import('@/hooks/useInventory')>(), useInventoryOverview: () => ({ data: { list: [], pagination: { total: 0 } } }), useOutbound: () => ({ mutate: vi.fn(), isPending: false }) }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [{ id: 7, name: '合成原仓' }] }) }))
vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: [] }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', async () => {
  const { useLocation } = await import('react-router-dom')
  return { useActiveWorkspaceTab: () => useLocation().pathname === '/inventory' }
})
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => false }))
vi.mock('@/components/finder', () => ({ ProductFinder: () => null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => <span>合成原仓</span> }))
vi.mock('@/components/shared/DatePicker', () => ({ DatePicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input type="date" value={value} onChange={e => onChange(e.target.value)} /> }))
vi.mock('@/components/shared/ContainerDrawer', () => ({ default: () => null }))
vi.mock('./ReservationDetailsDialog', () => ({ default: () => null }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const initial = '/inventory?tab=logs&logProductId=3&logProductName=合成商品&logWarehouseId=7&logWarehouseName=合成原仓&logStartDate=2026-10-01&logEndDate=2026-10-14'
let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const requests: URL[] = []
const transport = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  expect(url.pathname).toBe('/api/inventory/logs')
  requests.push(url)
  return respond(url)
})
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
function row(id: number) { return { id, productId: 3, productCode: 'SYN3', productName: '合成流水商品', warehouseId: 7, warehouseName: '合成原仓', type: 1, quantity: 1, beforeQty: id - 1, afterQty: id, unit: '个', createdAt: '2026-10-14 08:00:00', operatorName: '合成经办人' } }
function batch(url: URL, total: number) {
  const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 200)
  const from = (page - 1) * pageSize
  return new Response(JSON.stringify({ success: true, data: { list: Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => row(from + i + 1)), pagination: { page, pageSize, total } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const failure = () => new Response(JSON.stringify({ success: false, message: '合成流水读取中断' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
function Navigation() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="path">{location.pathname}{location.search}</output><button onClick={() => navigate('/other')}>切换工作区</button><button onClick={() => navigate(-1)}>返回库存</button><div hidden={location.pathname !== '/inventory'}><InventoryPage /></div></>
}
const button = (text: string, scope: ParentNode = document.body) => [...scope.querySelectorAll('button')].find(b => b.textContent === text)!
const text = () => host.textContent || ''
const wait = async (fn: () => void) => vi.waitFor(async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }); fn() })
async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[initial]}><Navigation /></MemoryRouter></QueryClientProvider>))
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); requests.length = 0; transport.mockClear(); onlineManager.setOnline(true)
  setApiClientBaseURL('http://inventory.fixture.invalid/api')
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); host.remove(); query.clear() }
  onlineManager.setOnline(true); apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api'); vi.unstubAllGlobals()
})
test('FE03-01 first fetch failure is a retryable read failure, never empty or zero total', async () => {
  respond = failure; await mount()
  await wait(() => expect(query.getQueryCache().find({ queryKey: ['inventory-logs'], exact: false })?.state.status).toBe('error'))
  expect(text()).toContain('库存流水读取失败'); expect(button('重试')).toBeTruthy()
  expect(text()).not.toMatch(/暂无(?:数据|流水)|共 0 条/)
})
test('FE03-02 continuation fetch failure rejects the partial batch instead of showing success', async () => {
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 201); await mount()
  await wait(() => expect(requests).toHaveLength(2))
  await wait(() => expect(text()).toContain('库存流水读取失败'))
  expect(query.getQueryCache().find({ queryKey: ['inventory-logs'], exact: false })?.state.data).toBeUndefined()
  expect(text()).not.toMatch(/合成流水商品|暂无(?:数据|流水)|共 0 条/)
})
test('FE03-03 5001 matches show the bounded 5000 records accurately with no visible pagination', async () => {
  respond = url => batch(url, 5001); await mount()
  await wait(() => expect(query.getQueryCache().find({ queryKey: ['inventory-logs'], exact: false })?.state.status).toBe('success'))
  expect(requests).toHaveLength(25)
  expect(text()).toContain('流水未取齐'); expect(text()).toContain('5,000'); expect(text()).toContain('5,001')
  expect(text()).not.toContain('共 5,001 条')
  expect(host.querySelector('table[aria-rowcount="5001"]')).not.toBeNull()
  expect(host.querySelectorAll('tbody tr').length).toBeLessThan(100)
  expect(text()).not.toMatch(/上一页|下一页/)
})
test('FE03-04 only a successful complete zero response says no logs', async () => {
  respond = url => batch(url, 0); await mount()
  await wait(() => expect(text()).toContain('暂无流水'))
  expect(text()).toContain('共 0 条'); expect(text()).not.toContain('读取失败')
})
test('FE03-05 actual query dialog keeps unapplied date draft when pending fetch settles', async () => {
  let release!: (response: Response) => void
  respond = () => new Promise(resolve => { release = resolve }); await mount()
  await wait(() => expect(release).toBeTypeOf('function'))
  await act(async () => button('查询').click())
  const start = document.body.querySelector<HTMLInputElement>('[role="dialog"] input[type="date"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(start, '2026-09-15'); start.dispatchEvent(new Event('change', { bubbles: true })); start.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(start.value).toBe('2026-09-15')
  await act(async () => release(batch(requests[0], 1)))
  await wait(() => expect(query.getQueryCache().find({ queryKey: ['inventory-logs'], exact: false })?.state.status).toBe('success'))
  expect(start.value).toBe('2026-09-15')
  await act(async () => button('取消', document.body.querySelector('[role="dialog"]')!).click())
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(initial)
})
test('FE03-06 retry keeps product warehouse date filters and close/return uses the same query', async () => {
  respond = failure; await mount(); await wait(() => expect(button('重试')).toBeTruthy())
  respond = url => batch(url, 1); await act(async () => button('重试').click())
  await wait(() => expect(text()).toContain('共 1 条'))
  for (const request of requests) expect(Object.fromEntries(request.searchParams)).toMatchObject({ productId: '3', warehouseId: '7', startDate: '2026-10-01', endDate: '2026-10-14' })
  await act(async () => button('查询').click()); await act(async () => button('取消', document.body.querySelector('[role="dialog"]')!).click())
  await act(async () => button('切换工作区').click()); await act(async () => button('返回库存').click())
  expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(initial)
  expect(text()).toContain('合成商品'); expect(text()).toContain('合成原仓')
})
test('FE03-07 background failure hides the old successful list and does not announce complete totals', async () => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(text()).toContain('合成流水商品'))
  respond = failure; await act(async () => { await query.invalidateQueries({ queryKey: ['inventory-logs'] }) })
  await wait(() => expect(text()).toContain('库存流水读取失败'))
  expect(text()).not.toMatch(/合成流水商品|共 1 条|暂无(?:流水|数据)/)
})
test('FE03-08 offline paused initial query is not successful emptiness and performs no fetch', async () => {
  onlineManager.setOnline(false); respond = url => batch(url, 0); await mount()
  await wait(() => expect(query.getQueryCache().find({ queryKey: ['inventory-logs'], exact: false })?.state.fetchStatus).toBe('paused'))
  expect(text()).toContain('网络已暂停'); expect(text()).not.toMatch(/暂无(?:数据|流水)|共 0 条/); expect(requests).toHaveLength(0)
})
test('FE03-09 paused refresh with cached rows does not present the old rows as current complete results', async () => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(text()).toContain('合成流水商品'))
  onlineManager.setOnline(false)
  await act(async () => { void query.invalidateQueries({ queryKey: ['inventory-logs'] }) })
  await wait(() => expect(text()).toContain('网络已暂停'))
  expect(text()).not.toMatch(/合成流水商品|暂无(?:数据|流水)|共 1 条/); expect(requests).toHaveLength(1)
})
test('FE03-10 refresh loading hides cached totals; recovered true empty is then explicit', async () => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(text()).toContain('共 1 条'))
  let release!: (response: Response) => void
  respond = () => new Promise(resolve => { release = resolve })
  await act(async () => { void query.invalidateQueries({ queryKey: ['inventory-logs'] }) })
  await wait(() => expect(release).toBeTypeOf('function'))
  expect(host.querySelector('table[aria-busy="true"]')).not.toBeNull()
  expect(text()).not.toMatch(/合成流水商品|暂无(?:数据|流水)|共 1 条/)
  await act(async () => release(batch(requests.at(-1)!, 0)))
  await wait(() => expect(text()).toContain('暂无流水')); expect(text()).toContain('共 0 条')
})
