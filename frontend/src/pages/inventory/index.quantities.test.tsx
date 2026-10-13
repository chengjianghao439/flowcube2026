// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { InventoryOverviewItem, InventoryOverviewParams, InventoryOverviewResult } from '@/types/inventory'
import Page from './index'

const fixture = vi.hoisted(() => ({ data: undefined as InventoryOverviewResult | undefined, flags: {} as Record<string, unknown>, active: true, refetch: vi.fn(), write: vi.fn(), params: [] as InventoryOverviewParams[] }))
vi.mock('@/hooks/useInventory', () => ({
  useInventoryOverview: (params: InventoryOverviewParams) => { fixture.params.push(params); return { data: fixture.data, isLoading: false, isFetching: false, isPlaceholderData: false, isPaused: false, error: null, refetch: fixture.refetch, ...fixture.flags } },
  useLogs: () => ({ data: { list: [], pagination: { total: 0 } }, isLoading: false }),
  useOutbound: () => ({ mutate: fixture.write, isPending: false }),
}))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: [] }) }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => fixture.active }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/components/shared/ContainerDrawer', () => ({ default: () => null }))
vi.mock('./ReservationDetailsDialog', () => ({ default: () => null }))
vi.mock('@/components/finder', () => ({ ProductFinder: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const row = (id: number, unit: string, onHand: number, reserved = 0): InventoryOverviewItem => ({ id, productId: id, productCode: `G-${id}`, productName: `商品${id}`, unit, warehouseId: 8, warehouseName: '合成仓库', articleNumber: null, spec: null, color: null, categoryId: null, categoryPath: '', onHand, reserved, available: Math.max(0, onHand - reserved), updatedAt: null })
function result(list: InventoryOverviewItem[], total = list.length): InventoryOverviewResult {
  const totalOnHand = list.reduce((sum, item) => sum + item.onHand, 0), totalReserved = list.reduce((sum, item) => sum + item.reserved, 0)
  const groups = new Map<string, { unit: string; onHand: number; reserved: number }>()
  for (const item of list) { const prev = groups.get(item.unit) ?? { unit: item.unit, onHand: 0, reserved: 0 }; groups.set(item.unit, { ...prev, onHand: prev.onHand + item.onHand, reserved: prev.reserved + item.reserved }) }
  return { stats: { totalSkus: list.length, totalOnHand, totalReserved, totalAvailable: Math.max(0, totalOnHand - totalReserved),
    ...(total === list.length ? { quantitiesByUnit: { complete: true, matchedRows: total, groups: [...groups.values()] } } : {}) }, list, pagination: { page: 1, pageSize: list.length, total } }
}
let host: HTMLDivElement, root: Root, qc: QueryClient
beforeEach(() => { fixture.flags = {}; fixture.active = true; fixture.params = []; fixture.refetch.mockReset(); fixture.write.mockReset(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); qc = new QueryClient() })
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); expect(fixture.write).not.toHaveBeenCalled() })
function FilterSwitch() { const navigate = useNavigate(); return <button onClick={() => navigate('/inventory?keyword=长度&warehouseId=9')}>切换合成筛选</button> }
async function draw() { await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/inventory?keyword=筛选商品&warehouseId=8']}><FilterSwitch /><Page /></MemoryRouter></QueryClientProvider>)) }
const card = (label: string) => [...host.querySelectorAll('p')].find(p => p.textContent === label)!.parentElement!

test('完整筛选明细的个米数量分开显示，三卡不混加且不发业务写入', async () => {
  fixture.data = result([row(1, '个', 100, 30), row(2, '米', 5, 1)])
  await draw()
  expect(card('在库数量').textContent).toContain('100 个'); expect(card('在库数量').textContent).toContain('5 米'); expect(card('在库数量').textContent).not.toContain('105')
  expect(card('已预占').textContent).toContain('30 个'); expect(card('已预占').textContent).toContain('1 米')
  expect(card('可用库存').textContent).toContain('70 个'); expect(card('可用库存').textContent).toContain('4 米')
  expect(fixture.params.at(-1)).toMatchObject({ keyword: '筛选商品', warehouseId: 8 })
})
test('同基本单位汇总保留原总卡公式，不把行级可用另换成新总量算法', async () => {
  fixture.data = result([row(1, '个', 20, 30), row(2, '个', 100, 0)])
  await draw()
  expect(card('在库数量').textContent).toContain('120 个'); expect(card('已预占').textContent).toContain('30 个'); expect(card('可用库存').textContent).toContain('90 个')
})
test.each(['', '   ', null, undefined])('未知基本单位%s不显示伪精确跨单位合计', async unit => {
  fixture.data = result([row(1, unit as unknown as string, 10), row(2, '米', 5)])
  await draw()
  for (const label of ['在库数量', '已预占', '可用库存']) expect(card(label).textContent).toContain('单位待核')
})
test('零量保留明确单位，空完整列表不虚构单位', async () => {
  fixture.data = result([row(1, '个', 0, 0)])
  await draw(); for (const label of ['在库数量', '已预占', '可用库存']) expect(card(label).textContent).toContain('0 个')
  fixture.data = result([]); await draw(); expect(card('在库数量').textContent).toContain('0'); expect(card('在库数量').textContent).not.toContain('个')
})
test('只读取部分匹配结果不能伪称全局数量，明确已读取及筛选边界', async () => {
  fixture.data = result([row(1, '个', 100)], 6000)
  await draw()
  for (const label of ['在库数量', '已预占', '可用库存']) expect(card(label).textContent).toContain('未取齐')
  expect(host.textContent).toContain('已读取 1 / 匹配 6,000 条'); expect(host.textContent).toContain('缩小筛选范围')
})
test.each([{ isFetching: true }, { isPlaceholderData: true }, { isPaused: true }, { error: new Error('读取失败') }])('旧数据或刷新未确认%s不作当前筛选精确总量', async flags => {
  fixture.data = result([row(1, '个', 100)])
  fixture.flags = flags; await draw()
  expect(card('在库数量').textContent).not.toContain('100')
  fixture.flags = {}; fixture.data = result([row(2, '米', 5)]); await draw(); expect(card('在库数量').textContent).toContain('5 米')
})

test('切换真实路由筛选时占位旧列表不作新总量，收到新筛选完整结果才展示', async () => {
  fixture.data = result([row(1, '个', 100)]); await draw()
  fixture.flags = { isPlaceholderData: true }; await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '切换合成筛选')!.click())
  expect(fixture.params.at(-1)).toMatchObject({ keyword: '长度', warehouseId: 9 })
  expect(card('在库数量').textContent).not.toContain('100')
  fixture.flags = {}; fixture.data = result([row(2, '米', 5)]); await draw()
  expect(card('在库数量').textContent).toContain('5 米'); expect(card('在库数量').textContent).not.toContain('个')
})
test('读取失败只重试本页当前筛选；隐藏工作区不启动新读取', async () => {
  fixture.data = result([row(1, '个', 100)]); fixture.flags = { error: new Error('合成读取失败') }; await draw()
  const retry = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '重试')!
  expect(retry()).toBeDefined(); await act(async () => retry().click()); expect(fixture.refetch).toHaveBeenCalledOnce()
  fixture.active = false; await draw(); await act(async () => retry().click()); expect(fixture.refetch).toHaveBeenCalledOnce()
})
test.each([NaN, Infinity])('未知数量%s不变成零或正常合计', async amount => {
  fixture.data = result([row(1, '个', amount)]); await draw()
  for (const label of ['在库数量', '已预占', '可用库存']) expect(card(label).textContent).toContain('数量待核')
})
test('明确截断标记即使计数碰巧相等也禁止精确总卡', async () => {
  const data = result([row(1, '个', 100)]); delete data.stats.quantitiesByUnit
  fixture.data = { ...data, truncated: true }; await draw()
  expect(card('在库数量').textContent).toContain('未取齐')
})
test('有服务端完整单位统计时，截断明细不被伪称全量，数量卡可独立显示全局统计', async () => {
  fixture.data = { ...result([row(1, '个', 100)], 6000), truncated: true }
  fixture.data.stats.quantitiesByUnit = { complete: true, matchedRows: 6000, groups: [{ unit: '个', onHand: 10000, reserved: 300 }] }
  await draw()
  expect(card('在库数量').textContent).toContain('10,000 个'); expect(card('可用库存').textContent).toContain('9,700 个')
  expect(host.textContent).toContain('已读取 1 / 匹配 6,000 条')
})
test('旧服务没有完整单位统计字段时，不从已取齐明细猜全局精确数量', async () => {
  fixture.data = result([row(1, '个', 100)]); delete fixture.data.stats.quantitiesByUnit
  await draw(); expect(card('在库数量').textContent).toContain('统计待核')
})
test('5000条数量取全集，表格只挂载可视行且可滚到最后一条', async () => {
  host.dataset.workspaceScroll = ''
  Object.defineProperty(host, 'clientHeight', { value: 480 }); Object.defineProperty(host, 'offsetHeight', { value: 480 }); Object.defineProperty(host, 'offsetWidth', { value: 800 })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this === host ? 480 : this.tagName === 'TR' ? 48 : 0
    return { height, width: 800, top: this === host ? 0 : -host.scrollTop, left: 0, bottom: height, right: 800, x: 0, y: 0, toJSON() {} }
  })
  fixture.data = result(Array.from({ length: 5000 }, (_, index) => row(index + 1, '个', 1)))
  await draw()
  expect(card('在库数量').textContent).toContain('5,000 个')
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  expect(host.textContent).not.toContain('商品5000')
  await act(async () => { host.scrollTop = 5000 * 48 - 480; host.dispatchEvent(new Event('scroll')) })
  expect(host.textContent).toContain('商品5000')
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
})
