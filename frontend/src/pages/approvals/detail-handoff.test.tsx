// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import CreditPage from '@/pages/credit-overrides'
import PricePage from '@/pages/price-change'
import DisposalPage from '@/pages/disposal'
import ExpensePage from '@/pages/finance/expenses'
import clientApi from '@/api/client'
import { OrderActivityDialog } from '@/components/shared/OrderActivityDialog'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), credit: vi.fn(), creditList: vi.fn(), disposal: vi.fn(), expense: vi.fn(), expenseList: vi.fn() }))
vi.mock('@/api/client', () => {
  const defaults = { baseURL: '/api' }
  return { default: { defaults }, getApiClientBaseURL: () => defaults.baseURL, subscribeApiClientBaseURL: () => () => {}, payloadClient: { get: api.get, post: api.post } }
})
vi.mock('@/api/credit-overrides', () => ({ getCreditOverrideApi: api.credit }))
vi.mock('@/hooks/useCreditOverrides', () => ({ useCreditOverrides: api.creditList, ...Object.fromEntries(['Create', 'Submit', 'Cancel', 'Approve', 'Reject'].map(k => [`use${k}CreditOverride`, () => ({ mutate: vi.fn() })])) }))
vi.mock('@/hooks/useDisposal', () => ({ useDisposalList: () => ({ data: { list: [], pagination: { total: 0 } } }), useDisposalDetail: () => ({ data: undefined }), useDisposalMutation: () => Object.fromEntries(['create', 'submit', 'approve', 'reject', 'dispose', 'cancel'].map(k => [k, { mutateAsync: vi.fn() }])) }))
vi.mock('@/api/disposal', () => ({ getDisposalDetailApi: api.disposal }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/api/finance', () => ({ getExpenseClaimsApi: api.expenseList, getExpenseClaimApi: api.expense, getExpenseCategoriesApi: async () => [], getActiveAccountsApi: async () => [] }))
vi.mock('@/components/shared/ProductFinderModal', () => ({ default: () => null }))
vi.mock('@/pages/disposal/components/CreateDisposalDialog', () => ({ default: () => null }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children, id }: { children: React.ReactNode; id: number }) => <div data-detail-id={id}>{children}</div> }))
vi.mock('@/components/ui/dialog', async importOriginal => ({ ...await importOriginal<typeof import('@/components/ui/dialog')>(), Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange?: (open: boolean) => void }) => open ? <div role="dialog">{children}<button aria-label="关闭详情弹窗" onClick={() => onOpenChange?.(false)}>关闭详情弹窗</button></div> : null, ...Object.fromEntries(['Content', 'Header', 'Title', 'Footer', 'Description'].map(k => [`Dialog${k}`, ({ children }: { children: React.ReactNode }) => <div>{children}</div>])) }))
let host: HTMLDivElement, root: Root, client: QueryClient
const cases = [
  { path: '/credit-overrides', Page: CreditPage, call: api.credit, data: { id: 91, overrideNo: 'CO-原单', status: 2 } },
  { path: '/price-change', Page: PricePage, call: api.get, data: { id: 91, requestNo: 'PCR-原单', status: 1 } },
  { path: '/disposals', Page: DisposalPage, call: api.disposal, data: { id: 91, disposalNo: 'DP-原单', status: 2 } },
  { path: '/finance/expenses', Page: ExpensePage, call: api.expense, data: { id: 91, claimNo: 'EC-原单', status: 2, items: [] } },
]
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); useAuthStore.setState({ token: 'offline-fixture', sessionGeneration: 1, user: { id: 7, username: 'tester', realName: '测试', roleId: 1, roleName: '测试' } }); api.get.mockReset().mockImplementation((url: string) => Promise.resolve(url === '/disposals/handling-sources' ? {list:[],summary:{total:0},pagination:{page:1,pageSize:20,total:0}} : url === '/price-change' ? { list: [], pagination: { total: 0 } } : { id: 91, requestNo: 'PCR-原单', status: 1 })); [api.credit, api.disposal, api.expense].forEach(fn => fn.mockReset()); api.creditList.mockReset().mockReturnValue({ data: { list: [], pagination: { total: 0 } } }); api.expenseList.mockReset().mockResolvedValue({ list: [], pagination: { total: 0 } }); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })
function LocationSync({ to }: { to: string }) { const navigate = useNavigate(); useEffect(() => { navigate(to) }, [navigate, to]); return null }
async function render(path: string, Page: React.ComponentType, location = path) { act(() => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[location]}><LocationSync to={location} /><TabPathContext.Provider value={path}><Page /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>)); await act(async () => { await new Promise(done => setTimeout(done, 35)) }); await act(async () => { await new Promise(done => setTimeout(done, 35)) }) }
function KeptPage({ path, Page }: { path: string; Page: React.ComponentType }) {
  const location = useLocation()
  return <KeepAliveSection active={location.pathname === path.split('?')[0]} data-kept-approval><TabPathContext.Provider value={path}><Page /></TabPathContext.Provider></KeepAliveSection>
}
async function renderKept(path: string, Page: React.ComponentType, location = path) {
  act(() => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[location]}><LocationSync to={location} /><KeptPage path={path} Page={Page} /></MemoryRouter></QueryClientProvider>))
  await act(async () => { await new Promise(done => setTimeout(done, 35)) }); await act(async () => { await new Promise(done => setTimeout(done, 35)) })
}
test.each(cases)('$path 精确读取detailId并打开现有详情，不依赖列表首屏', async ({ path, Page, call, data }) => {
  if (path !== '/price-change') call.mockResolvedValue(data)
  await render(`${path}?detailId=91`, Page)
  expect(call).toHaveBeenCalledWith(...(path === '/price-change' ? ['/price-change/91'] : [91]))
  expect(host.querySelector('[data-detail-id="91"]')).not.toBeNull(); expect(host.textContent).toContain('原单')
})
test.each(['detailId=', 'detailId=0', 'detailId=1e2', 'detailId=91&detailId=92', 'detailId=9007199254740992'])('非法原单交接拒绝读取：%s', async search => {
  await render(`/credit-overrides?${search}`, CreditPage); expect(api.credit).not.toHaveBeenCalled(); expect(host.textContent).toContain('原单定位信息无效')
})
test('读取不一致的原单id时不打开详情', async () => { api.credit.mockResolvedValue({ id: 92, overrideNo: '别单' }); await render('/credit-overrides?detailId=91', CreditPage); expect(host.querySelector('[data-detail-id]')).toBeNull(); expect(host.textContent).toContain('原单读取失败') })
test('已有新建草稿接收交接仍保留输入，不自动覆盖或关闭', async () => {
  api.credit.mockResolvedValue({ id: 91, overrideNo: 'CO-原单' }); await render('/credit-overrides?keyword=原查询', CreditPage)
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '发起申请')!.click())
  const textarea = host.querySelector<HTMLTextAreaElement>('#credit-reason')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '已填草稿'); textarea.dispatchEvent(new Event('input', { bubbles: true })) })
  await render('/credit-overrides?keyword=原查询&detailId=91', CreditPage)
  expect(host.querySelector<HTMLTextAreaElement>('#credit-reason')!.value).toBe('已填草稿'); expect(api.credit).not.toHaveBeenCalled(); expect(host.textContent).toContain('先关闭当前弹窗')
})
test('在途A晚到不会替代当前B原单', async () => {
  let resolveA!: (value: { id: number; overrideNo: string }) => void
  api.credit.mockImplementation((id: number) => id === 91 ? new Promise(done => { resolveA = done }) : Promise.resolve({ id: 92, overrideNo: 'CO-B' }))
  await render('/credit-overrides?detailId=91', CreditPage); await render('/credit-overrides?detailId=92', CreditPage)
  await act(async () => { resolveA({ id: 91, overrideNo: 'CO-A' }); await new Promise(done => setTimeout(done, 30)) })
  expect(host.textContent).toContain('CO-B'); expect(host.textContent).not.toContain('CO-A'); expect(host.querySelector('[data-detail-id="92"]')).not.toBeNull()
})
test.each(['账号', '权限', '服务器'])('在途读取期间%s变化，旧响应不能打开原单', async change => {
  let resolve!: (value: { id: number; overrideNo: string }) => void
  api.credit.mockImplementation(() => new Promise(done => { resolve = done }))
  await render('/credit-overrides?detailId=91', CreditPage)
  if (change === '服务器') clientApi.defaults.baseURL = '/other-api'
  else act(() => useAuthStore.setState({ ...(change === '账号' ? { sessionGeneration: 2 } : {}), user: { id: change === '账号' ? 8 : 7, username: 'other', realName: '其他', roleId: 5, roleName: '测试', permissions: [] } }))
  await act(async () => { resolve({ id: 91, overrideNo: '过期原单' }); await new Promise(done => setTimeout(done, 35)) })
  expect(host.querySelector('[data-detail-id]')).toBeNull(); expect(host.textContent).not.toContain('过期原单')
  clientApi.defaults.baseURL = '/api'
})
test('已打开处置驳回草稿接收B时保留A及原因，先关闭后再定位B', async () => {
  api.disposal.mockImplementation((id: number) => Promise.resolve({ id, disposalNo: id === 91 ? 'DP-A' : 'DP-B', status: 2, items: [] }))
  await render('/disposals?detailId=91', DisposalPage)
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '驳回')!.click())
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!
  expect(input).not.toBeNull()
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '处置驳回草稿'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await render('/disposals?detailId=92', DisposalPage)
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('处置驳回草稿')
  expect(host.textContent).toContain('DP-A'); expect(host.textContent).not.toContain('DP-B')
  expect(host.textContent).toContain('先关闭当前原单')
})
test('旧productId入口创建成功后不自动重开同一申请', async () => {
  api.get.mockImplementation((url: string) => Promise.resolve(url === '/products/41' ? { id: 41, code: 'P41', name: '旧URL商品' } : { list: [], pagination: { total: 0 } }))
  api.post.mockResolvedValue({ id: 101, requestNo: 'PCR101' })
  await render('/price-change?productId=41', PricePage)
  const input = host.querySelector<HTMLInputElement>('input[placeholder="输入新价格"]')!
  expect(input).not.toBeNull()
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '12'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '创建申请')!.click())
  await act(async () => { await new Promise(done => setTimeout(done, 40)) })
  expect(api.post).toHaveBeenCalledTimes(1); expect(host.querySelector('input[placeholder="输入新价格"]')).toBeNull()
})

test('关闭审批费用原单后，手动打开另一单展示其自身明细', async () => {
  api.expenseList.mockResolvedValue({ list: [{ id: 92, claimNo: 'EC-B', status: 3 }], pagination: { total: 1 } })
  api.expense.mockImplementation((id: number) => Promise.resolve({ id, claimNo: `EC-${id}`, items: [{ description: `明细-${id}` }] }))
  await render('/finance/expenses?detailId=91', ExpensePage)
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '关闭')!.click())
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '明细')!.click())
  await act(async () => { await new Promise(done => setTimeout(done, 40)) })
  const detail = host.querySelector('[data-detail-id="92"]')!
  expect(detail).not.toBeNull(); expect(detail.textContent).toContain('明细-92'); expect(detail.textContent).not.toContain('明细-91')
})

test('已打开审批费用换账号后重新读取，禁止保留旧账号明细或阻塞新账号定位', async () => {
  api.expense.mockResolvedValueOnce({ id: 91, claimNo: '旧账号费用', items: [{ description: '旧账号明细' }] }).mockResolvedValue({ id: 91, claimNo: '新账号费用', items: [{ description: '新账号明细' }] })
  await render('/finance/expenses?detailId=91', ExpensePage)
  expect(host.textContent).toContain('旧账号明细')
  act(() => useAuthStore.setState({ sessionGeneration: 2, user: { id: 8, username: 'other', realName: '其他', roleId: 1, roleName: '测试' } }))
  expect(host.textContent).not.toContain('旧账号明细')
  await act(async () => { await new Promise(done => setTimeout(done, 40)) })
  await act(async () => { await new Promise(done => setTimeout(done, 40)) })
  expect(api.expense).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('新账号明细'); expect(host.textContent).not.toContain('旧账号明细')
})

test('detailId优先于保留的旧productId，不读取商品或弹出新建', async () => {
  api.get.mockImplementation((url: string) => Promise.resolve(url === '/products/41' ? { id: 41, code: 'P41', name: '旧商品' } : url === '/price-change/91' ? { id: 91, requestNo: 'PCR-审批原单' } : { list: [], pagination: { total: 0 } }))
  await render('/price-change?productId=41&detailId=91', PricePage)
  expect(api.get).not.toHaveBeenCalledWith('/products/41'); expect(host.querySelector('input[placeholder="输入新价格"]')).toBeNull(); expect(host.textContent).toContain('PCR-审批原单')
})

test.each(['审批交接', '后台标签', '其他详情'])('旧商品在途响应遇到%s不得迟到打开新建', async change => {
  let resolve!: (value: { id: number; code: string; name: string }) => void
  api.get.mockImplementation((url: string) => url === '/products/41' ? new Promise(done => { resolve = done }) : Promise.resolve(url === '/price-change/91' ? { id: 91, requestNo: 'PCR-审批原单' } : { list: [{ id: 92, requestNo: 'PCR-手动单', status: 2 }], pagination: { total: 1 } }))
  await render('/price-change?productId=41', PricePage)
  if (change === '审批交接') await render('/price-change?productId=41&detailId=91', PricePage)
  else if (change === '后台标签') await render('/price-change?productId=41', PricePage, '/credit-overrides')
  else act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '详情 / 记录')!.click())
  await act(async () => { resolve({ id: 41, code: 'P41', name: '迟到商品' }); await new Promise(done => setTimeout(done, 40)) })
  expect(host.querySelector('input[placeholder="输入新价格"]')).toBeNull()
})

test('后台商品预选标签不发起商品读取', async () => {
  await render('/price-change?productId=41', PricePage, '/credit-overrides')
  expect(api.get).not.toHaveBeenCalledWith('/products/41'); expect(host.querySelector('input[placeholder="输入新价格"]')).toBeNull()
})

test.each(cases.slice(0, 2))('$path 手动详情原行移除后释放弹窗阻挡，新审批原单正常定位', async ({ path, Page, call, data }) => {
  const row = { id: 92, overrideNo: 'CO-手动', requestNo: 'PCR-手动', status: 2 }
  api.creditList.mockReturnValue({ data: { list: [row], pagination: { total: 1 } } })
  api.credit.mockResolvedValue(data)
  api.get.mockImplementation((url: string) => Promise.resolve(url === '/price-change' ? { list: [row], pagination: { total: 1 } } : data))
  await render(path, Page)
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '详情 / 记录')!.click())
  expect(host.querySelector('[data-detail-id="92"]')).not.toBeNull()
  api.creditList.mockReturnValue({ data: { list: [], pagination: { total: 0 } } })
  act(() => client.setQueryData(['price-change', { page: 1, keyword: '' }], { list: [], pagination: { total: 0 } }))
  await render(path, Page)
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  await render(`${path}?detailId=91`, Page)
  expect(call).toHaveBeenCalledWith(...(path === '/price-change' ? ['/price-change/91'] : [91]))
  expect(host.querySelector('[data-detail-id="91"]')).not.toBeNull()
  expect(host.textContent).not.toContain('先关闭当前弹窗')
})

test.each(cases.slice(0, 2))('$path 未打开行移除不释放另一个仍打开的手动详情', async ({ path, Page, data }) => {
  const rows = [92, 93].map(id => ({ id, overrideNo: `CO-${id}`, requestNo: `PCR-${id}`, status: 2 }))
  api.creditList.mockReturnValue({ data: { list: rows, pagination: { total: 2 } } })
  api.credit.mockResolvedValue(data)
  api.get.mockImplementation((url: string) => Promise.resolve(url === '/price-change' ? { list: rows, pagination: { total: 2 } } : data))
  await render(path, Page)
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '详情 / 记录')!.click())
  api.creditList.mockReturnValue({ data: { list: [rows[0]], pagination: { total: 1 } } })
  act(() => client.setQueryData(['price-change', { page: 1, keyword: '' }], { list: [rows[0]], pagination: { total: 1 } }))
  await render(`${path}?detailId=91`, Page)
  expect(host.querySelector('[data-detail-id="92"]')).not.toBeNull()
  expect(host.querySelector('[data-detail-id="91"]')).toBeNull()
  expect(host.textContent).toContain('先关闭当前弹窗')
})

test('受控审批详情卸载不通知关闭新上下文', () => {
  const notify = vi.fn()
  act(() => root.render(<OrderActivityDialog key="old" type="price" id={91} title="旧上下文" fields={[]} open hideTrigger onOpenChange={notify} />))
  act(() => root.render(<OrderActivityDialog key="new" type="price" id={92} title="新上下文" fields={[]} open hideTrigger onOpenChange={notify} />))
  expect(notify).not.toHaveBeenCalled(); expect(host.querySelector('[data-detail-id="92"]')).not.toBeNull()
})

test.each(cases)('$path KeepAlive关闭后同页不自动重开，离开再点击同原单重新读取打开', async ({ path, Page, call, data }) => {
  if (path !== '/price-change') call.mockResolvedValue(data)
  const target = `${path}?detailId=91`
  const detailReads = () => path === '/price-change' ? api.get.mock.calls.filter(([url]) => url === '/price-change/91').length : call.mock.calls.length
  await renderKept(target, Page)
  const keptElement = host.querySelector('[data-kept-approval]')
  expect(host.querySelector('[data-detail-id="91"]')).not.toBeNull(); expect(detailReads()).toBe(1)
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="关闭详情弹窗"]')!.click())
  await renderKept(target, Page)
  expect(host.querySelector('[data-detail-id="91"]')).toBeNull(); expect(detailReads()).toBe(1)
  await renderKept(target, Page, '/dashboard')
  expect(host.querySelector('[data-kept-approval]')).toBe(keptElement)
  await renderKept(target, Page)
  expect(host.querySelector('[data-kept-approval]')).toBe(keptElement)
  expect(host.querySelector('[data-detail-id="91"]')).not.toBeNull(); expect(detailReads()).toBe(2)
})

test('KeepAlive离开后重回同审批链接时，新建草稿仍阻挡交接并保留输入', async () => {
  api.credit.mockResolvedValue({ id: 91, overrideNo: 'CO-审批原单' })
  const path = '/credit-overrides?detailId=91'
  await renderKept(path, CreditPage)
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="关闭详情弹窗"]')!.click())
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '发起申请')!.click())
  const textarea = host.querySelector<HTMLTextAreaElement>('#credit-reason')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '保留新建原因'); textarea.dispatchEvent(new Event('input', { bubbles: true })) })
  await renderKept(path, CreditPage, '/dashboard'); await renderKept(path, CreditPage)
  expect(host.querySelector<HTMLTextAreaElement>('#credit-reason')).toBe(textarea)
  expect(textarea.value).toBe('保留新建原因'); expect(api.credit).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[data-detail-id="91"]')).toBeNull(); expect(host.textContent).toContain('先关闭当前弹窗')
})
