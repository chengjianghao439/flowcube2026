// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import clientApi, { setApiClientBaseURL } from '@/api/client'
import ReservationDetailsDialog from './ReservationDetailsDialog'
import InventoryPage from './index'
const api = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn(async () => null) }))
vi.mock('@/api/inventory', () => ({ getInventoryReservationsApi: api.read }))
vi.mock('@/hooks/useInventory', () => ({ useInventoryOverview: () => ({ data: { list: [{ id: 1, productId: 7, warehouseId: 8, productName: '商品A', warehouseName: '仓库A', onHand: 40, reserved: 0, available: 40 }], pagination: { total: 1 } } }), useLogs: () => ({ data: { list: [] } }), useOutbound: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: [] }) }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
vi.mock('@/components/shared/ContainerDrawer', () => ({ default: () => null }))
vi.mock('@/components/finder', () => ({ ProductFinder: () => null }))
vi.mock('@/components/ui/dialog', async importOriginal => ({ ...await importOriginal<typeof import('@/components/ui/dialog')>(), Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null, ...Object.fromEntries(['Content', 'Header', 'Title', 'Footer', 'Description'].map(k => [`Dialog${k}`, ({ children }: { children: React.ReactNode }) => <div>{children}</div>])) }))
const item = { productId: 7, warehouseId: 8, productName: '商品A', warehouseName: '仓库A', unit: '件' }
function result(productId = 7, warehouseId = 8, orderNo = 'SO-当前') {
  return { productId, warehouseId, summary: { activeQuantity: 30, cacheOnHand: 32, reserved: 50, available: 0, expected: 25, atp: 5, pickableQuantity: 12, reservationQuantity: 40, expectedBindingQuantity: 33, expectedPoolBindingQuantity: 25, cacheDifference: 2, reservationDifference: 10, bindingPoolDifference: 8, visibleReservationQuantity: 20, hiddenReservationQuantity: 12, orphanReservationQuantity: 6, unknownReservationQuantity: 2, visibleBindingQuantity: 28, hiddenBindingQuantity: 5, orphanBindingQuantity: 0 }, list: [{ saleOrderId: 11, orderNo, customerName: '授权客户', status: 2, createdAt: '2026-10-04 10:00:00', reservationQuantity: 20, expectedBindingQuantity: 28, hiddenBindingQuantity: 0, orphanBindingQuantity: 3, bindings: [{ bindingId: 1, saleOrderItemId: 41, quantity: 25, sourceState: 'expected_supply', purchase: { purchaseOrderId: 201, purchaseItemId: 301, orderNo: 'PO-当前', status: 2, openQuantity: 25, boundQuantity: 25 } }] }], pagination: { page: 1, pageSize: 20, total: 21 } }
}
let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); useAuthStore.setState({ sessionGeneration: 1, user: { id: 9, username: 'test', realName: '测试', roleId: 1, roleName: '测试' } }); api.read.mockReset().mockResolvedValue(result()); clientApi.defaults.baseURL = '/api'; client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300000 } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })
async function flush() { await act(async () => { await new Promise(done => setTimeout(done, 35)) }) }
function draw(nextItem = item, open = true, active = true) { act(() => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/inventory']}><KeepAliveSection active={active}><ReservationDetailsDialog item={nextItem} open={open} onClose={() => {}} /></KeepAliveSection></MemoryRouter></QueryClientProvider>)) }
test('真实弹窗解释三种数量及差异、准确原单链接，并使用真正第二页', async () => {
  api.read.mockImplementation(async ({ productId, warehouseId, page }) => ({ ...result(productId, warehouseId, page === 2 ? 'SO-第二页' : 'SO-当前'), pagination: { page, pageSize: 20, total: 21 } }))
  draw(); await flush(); await flush()
  expect(host.textContent).toContain('实物在库'); expect(host.textContent).toContain('含预计可承诺'); expect(host.textContent).toContain('不保证本单可直接发货')
  expect(host.querySelector('a[href="/sale/11"]')).not.toBeNull(); expect(host.querySelector('a[href="/purchase/201"]')).not.toBeNull()
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '下一页')!.click()); await flush(); await flush()
  expect(api.read.mock.calls.at(-1)?.[0]).toEqual({ productId: 7, warehouseId: 8, page: 2, pageSize: 20 })
  expect(host.textContent).toContain('SO-第二页'); expect(host.textContent).not.toContain('SO-当前')
})
test('库存总览零预占也可点击解释，保留原在库/可用数值', async () => {
  act(() => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/inventory']}><InventoryPage /></MemoryRouter></QueryClientProvider>))
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="查看商品A在仓库A的预占明细"]')
  expect(button).not.toBeNull(); expect(button?.textContent).toBe('0')
  act(() => button!.click()); await flush(); await flush()
  expect(api.read.mock.calls[0]?.[0]).toEqual({ productId: 7, warehouseId: 8, page: 1, pageSize: 20 })
  expect(host.textContent).toContain('库存预占明细')
})
test('维度A迟到不替换B的概要/原单，不能用跨维度placeholder', async () => {
  let resolve!: (value: ReturnType<typeof result>) => void
  api.read.mockImplementation(({ productId, warehouseId }) => productId === 7 ? new Promise(done => { resolve = done }) : Promise.resolve(result(productId, warehouseId, 'SO-B')))
  draw(); await flush(); draw({ ...item, productId: 9, warehouseId: 10 }); await flush(); await flush()
  await act(async () => { resolve(result(7, 8, 'SO-A迟到')); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).toContain('SO-B'); expect(host.textContent).not.toContain('SO-A迟到')
})
test.each(['账号', '权限', '服务器'])('%s变化隔离旧概要和迟到原单', async change => {
  let resolve!: (value: ReturnType<typeof result>) => void
  api.read.mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(result(7, 8, 'SO-新上下文'))
  draw(); await flush()
  if (change === '服务器') act(() => { setApiClientBaseURL('/new-api') })
  else act(() => useAuthStore.setState({ sessionGeneration: 2, user: { id: change === '账号' ? 10 : 9, username: 'new', realName: '测试', roleId: change === '权限' ? 5 : 1, roleName: '测试', permissions: change === '权限' ? [] : undefined } }))
  await flush(); await act(async () => { resolve(result(7, 8, 'SO-旧上下文')); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).not.toContain('SO-旧上下文')
  if (change === '权限') expect(host.textContent).toContain('没有查看库存的权限')
  else expect(host.textContent).toContain('SO-新上下文')
})
test('服务器地址变化无需父组件draw，立即移除已显示旧原单并fresh读取', async () => {
  draw(); await flush(); await flush()
  expect(host.textContent).toContain('SO-当前'); expect(host.querySelector('a[href="/sale/11"]')).not.toBeNull()
  let resolve!: (value: ReturnType<typeof result>) => void
  api.read.mockImplementation(() => new Promise(done => { resolve = done }))
  act(() => { setApiClientBaseURL('/new-api') })
  await flush()
  expect(host.textContent).not.toContain('SO-当前'); expect(host.querySelector('a[href="/sale/11"]')).toBeNull()
  expect(api.read.mock.calls.at(-1)?.[1]).toMatchObject({ baseURL: '/new-api' })
  await act(async () => { resolve(result(7, 8, 'SO-新服务器')); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).toContain('SO-新服务器')
})
test('重开及KeepAlive重新激活必须fresh，读取中不显示上次缓存原单', async () => {
  draw(); await flush(); await flush(); expect(host.textContent).toContain('SO-当前')
  let resolve!: (value: ReturnType<typeof result>) => void
  api.read.mockImplementation(() => new Promise(done => { resolve = done }))
  draw(item, false); await flush(); draw(); expect(host.textContent).not.toContain('SO-当前'); await flush()
  await act(async () => { resolve(result(7, 8, 'SO-重开')); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).toContain('SO-重开')
  draw(item, true, false); await flush(); const before = api.read.mock.calls.length
  draw(); expect(host.textContent).not.toContain('SO-重开'); await flush()
  expect(api.read.mock.calls.length).toBe(before + 1)
})
test('返回维度不一致时拒绝原单，失败可显式重试', async () => {
  api.read.mockResolvedValueOnce(result(9, 10, '错维度来源')).mockResolvedValue(result())
  draw(); await flush(); await flush()
  expect(host.textContent).not.toContain('错维度来源'); expect(host.textContent).toContain('读取失败')
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '重试')!.click()); await flush(); await flush()
  expect(host.textContent).toContain('SO-当前')
})
