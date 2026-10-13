// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PurchasePage from './index'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { WorkspaceTabs } from '@/components/layout/WorkspaceTabs'
import { TopNav } from '@/components/layout/TopNav'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import { defaultRangeYmds } from '@/lib/dateTime'

const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/api/purchase', async original => ({ ...await original<typeof import('@/api/purchase')>(), getPurchaseListApi: api.list }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useUserOptions', () => ({ useUserOptions: () => ({ options: [] }), userOptionLabel: () => '' }))
vi.mock('@/components/finder', () => ({ CustomerFinder: () => null, SupplierFinder: () => null, ProductFinder: () => null }))
vi.mock('./components/ReserveAllocationDialog', () => ({ default: () => null }))
vi.mock('./components/StockShortageDialog', () => ({ default: () => null }))
vi.mock('./commercial/CommercialPurchasePage', () => ({ default: () => null, NewCommercialSale: ({ onDone }: { onDone: () => void }) => <button onClick={() => onDone()}>取消测试新建</button> }))
vi.mock('@/pages/sale/RepeatSaleRecoveryPage', () => ({ RepeatSaleRecoveryEntry: () => null }))
vi.mock('@/pages/supplier-refunds/RefundRecoveryPage', () => ({ RefundRecoveryEntry: () => null }))
vi.mock('@/pages/disposal/DisposalRecoveryPage', () => ({ DisposalRecoveryEntry: () => null }))
vi.mock('@/router/routeRegistry', async original => ({
  ...await original<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === '/purchase' ? PurchasePage : () => <p>只读详情</p>,
}))

let host: HTMLDivElement, root: Root, cache: QueryClient, navigate: NavigateFunction
const dateRange = { startDate: '2026-10-08', endDate: '2026-10-08' }
const extra = { keyword: 'PO', remark: '合成', status: '1', operatorId: '7', operatorName: '经办人', productId: '8', productCode: 'P8', productName: '商品', supplierId: '9', supplierName: '客户', warehouseId: '10', warehouseName: '仓' }
const appliedPath = `/purchase?${new URLSearchParams({ ...dateRange, ...extra })}`
function Harness() { const location = useLocation(); navigate = useNavigate(); return <><output data-location>{location.pathname + location.search}</output><TopNav /><WorkspaceTabs /><KeepAliveOutlet /></> }
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
const button = (name: string) => {
  const matches = (b: HTMLButtonElement) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name
  return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(matches)
    ?? [...host.querySelectorAll<HTMLButtonElement>('button')].filter(b => !b.closest('[style*="display: none"]')).find(matches)!
}
const click = async (name: string) => { await act(async () => button(name).click()); await settle() }
const go = async (path: string | number) => { await act(async () => typeof path === 'number' ? navigate(path) : navigate(path)); await settle() }
const current = () => new URLSearchParams(host.querySelector('[data-location]')!.textContent!.split('?')[1])
const request = () => api.list.mock.calls.at(-1)?.[0]
const dates = () => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[placeholder="yyyy-mm-dd"]')]
const input = async (element: HTMLInputElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) }); await act(async () => { element.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }) }
async function render(path = appliedPath) { await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter></QueryClientProvider>)); await settle() }
function retained() { expect(Object.fromEntries(current())).toMatchObject({ ...dateRange, ...extra }); expect(request()).toMatchObject({ ...dateRange, keyword: extra.keyword, remark: extra.remark, status: extra.status, operatorId: 7, productId: 8, supplierId: 9, warehouseId: 10 }); expect(host.textContent).toContain('自定义日期结果') }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  api.list.mockReset().mockImplementation(async (params: Record<string, unknown>) => ({ list: [{ id: 42, orderNo: params.startDate === dateRange.startDate && params.endDate === dateRange.endDate ? '自定义日期结果' : '默认日期结果', status: 1, totalAmount: 1, createdAt: '2026-10-08' }], pagination: { total: 1 } }))
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); vi.unstubAllGlobals(); disposeWorkspaceHistoryGuard(); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }) })


test('采购已应用完整筛选关闭详情后保留URL/控件/结果与查询参数', async () => {
 await render(); retained(); await go('/purchase/42'); await click('关闭 采购订单 #42'); retained()
 await click('查询'); expect(dates().map(el=>el.value)).toEqual([dateRange.startDate,dateRange.endDate])
})
test('采购详情隐藏期间不以另一标签的空参数发默认列表查询', async () => {
 await render(); retained(); api.list.mockClear(); await go('/purchase/42')
 expect(api.list.mock.calls.every(([params])=>params.startDate===dateRange.startDate&&params.keyword===extra.keyword)).toBe(true)
})
test('采购顶部菜单回到现有列表应沿用其完整查询路径', async () => {
 await render(); await go('/purchase/42')
 await act(async()=>button('采购').dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));await settle()
 const entry=[...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(el=>el.textContent==='采购订单')!
 expect(entry).toBeDefined();await act(async()=>entry.click());await settle();retained()
})
test('查询临时日期和备注取消不覆盖已应用条件；主动重置仅在查询确认后生效', async () => {
  await render(); await click('查询'); expect(dates().map(el => el.value)).toEqual([dateRange.startDate, dateRange.endDate])
  await input(dates()[0], '2026-10-01')
  const remark = [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find(label => label.textContent === '备注')!.querySelector<HTMLInputElement>('input')!
  await input(remark, '未确认的备注'); await click('取消'); retained()
  await click('查询'); expect(dates().map(el => el.value)).toEqual([dateRange.startDate, dateRange.endDate])
  await click('重置'); const defaults = defaultRangeYmds(7); expect(dates().map(el => el.value)).toEqual([defaults.start, defaults.end]); retained()
  await click('取消'); retained(); await click('查询'); await click('重置'); await click('查询')
  expect(request()).toMatchObject({ startDate: defaults.start, endDate: defaults.end, keyword: '' })
  expect(current().get('startDate')).toBe(defaults.start); expect(current().get('remark')).toBeNull()
})
test('从默认列表实际应用自定义日期后再开详情并关闭，显示与读取始终使用已确认日期', async () => {
  await render('/purchase'); await click('查询')
  await input(dates()[0], dateRange.startDate); await input(dates()[1], dateRange.endDate); await click('查询')
  expect(request()).toMatchObject(dateRange); expect(host.textContent).toContain('自定义日期结果')
  api.list.mockClear(); await go('/purchase/42'); await click('关闭 采购订单 #42')
  expect(current().get('startDate')).toBe(dateRange.startDate); expect(current().get('endDate')).toBe(dateRange.endDate)
  expect(host.textContent).toContain('自定义日期结果')
  expect(api.list.mock.calls.every(([params]) => params.startDate === dateRange.startDate && params.endDate === dateRange.endDate)).toBe(true)
  await click('查询'); expect(dates().map(el => el.value)).toEqual([dateRange.startDate, dateRange.endDate])
})

test('实际采购URL前进后退与反复详情返回使用该次历史筛选',async()=>{
 await render();await go('/purchase?keyword=NEXT&startDate=2026-10-09&endDate=2026-10-09');expect(current().get('keyword')).toBe('NEXT')
 await go(-1);expect(Object.fromEntries(current())).toMatchObject({ ...dateRange, ...extra });expect(host.textContent).toContain('自定义日期结果');await go(1);expect(current().get('keyword')).toBe('NEXT');expect(request()).toMatchObject({keyword:'NEXT',startDate:'2026-10-09'})
 for(let n=0;n<2;n++){await go('/purchase/42');await click('关闭 采购订单 #42');expect(current().get('keyword')).toBe('NEXT');expect(request()).toMatchObject({keyword:'NEXT',startDate:'2026-10-09'})}
})
