// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProfitAnalysisPage from './profit-analysis'
import InventoryAgingPage from './inventory-aging'
import { getProfitAnalysisApi } from '@/api/reports'
import { getInventoryAgingApi, getExpiryAlertsApi } from '@/api/inventory'

vi.mock('@/api/reports', () => ({ getProfitAnalysisApi: vi.fn() }))
vi.mock('@/api/inventory', () => ({ getInventoryAgingApi: vi.fn(), getExpiryAlertsApi: vi.fn() }))
vi.mock('./InventoryAgingQueryDialog', () => ({ default: () => null }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))

let host: HTMLDivElement, root: Root, client: QueryClient
const report = {
  summary: { saleAmount: 100, costAmount: 120, grossProfit: -20, stockValue: 1500, slowMovingValue: 200, slowMovingCount: 1 },
  saleOrders: [{ id: 1, orderNo: 'SO-REPORT-1', customerName: '测试客户', warehouseName: '测试仓', totalAmount: 100, costAmount: 120, grossProfit: -20, marginRate: -20, path: '/sale/1' }],
  products: [], stockValue: [],
  slowMoving: [{ id: 2, code: 'SLOW-2', name: '滞销测试商品', unit: '件', articleNumber: null, spec: null, color: null, currentQty: 2, stockValue: 200, lastOutboundAt: null, outbound90d: 0, path: '/inventory/overview' }],
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); localStorage.clear() })
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
async function render(page: ReactNode) {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}>{page}</QueryClientProvider></MemoryRouter>))
  await settle()
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(el => el.textContent === label)
  expect(button, label).toBeTruthy()
  await act(async () => button!.click()); await settle()
}
function visibleText() { return [...host.querySelectorAll('p, td, h3')].filter(el => !el.closest('[hidden]')).map(el => el.textContent).join(' ') }

it('利润数据未加载或首次失败时不把未知金额显示成零', async () => {
  vi.mocked(getProfitAnalysisApi).mockImplementation(() => new Promise(() => {}))
  await render(<ProfitAnalysisPage />)
  expect(host.textContent).not.toContain('¥0.00')
  expect(host.textContent).toContain('正在加载')
})
it('利润首次失败给出重试入口且不显示零值或空数据结论', async () => {
  vi.mocked(getProfitAnalysisApi).mockRejectedValue(new Error('测试请求失败'))
  await render(<ProfitAnalysisPage />)
  expect(host.textContent).toContain('利润 / 库存分析加载失败')
  expect(host.textContent).not.toContain('¥0.00')
  expect(visibleText()).not.toContain('暂无销售毛利数据')
})
it('利润刷新失败保留原表格并明确提示当前是上次成功数据', async () => {
  vi.mocked(getProfitAnalysisApi).mockResolvedValueOnce(report).mockRejectedValue(new Error('测试刷新失败'))
  await render(<ProfitAnalysisPage />)
  await click('立即刷新')
  expect(host.textContent).toContain('刷新失败，当前显示上次成功的数据')
  expect(visibleText()).toContain('SO-REPORT-1')
  expect(host.textContent).toContain('¥-20.00')
  vi.mocked(getProfitAnalysisApi).mockResolvedValue(report)
  await click('立即刷新')
  expect(host.textContent).not.toContain('刷新失败，当前显示上次成功的数据')
})
it('滞销卡片是键盘可操作按钮，打开本页同口径明细', async () => {
  vi.mocked(getProfitAnalysisApi).mockResolvedValue(report)
  await render(<ProfitAnalysisPage />)
  const card = host.querySelector('button[aria-label="查看滞销库存明细"]')
  expect(card).not.toBeNull()
  await act(async () => (card as HTMLButtonElement).click())
  expect(visibleText()).toContain('滞销测试商品')
  expect(host.textContent).toContain('前 30')
})
it('库龄首次失败不能显示暂无库存，刷新不请求未打开的效期预警', async () => {
  vi.mocked(getInventoryAgingApi).mockRejectedValue(new Error('测试库龄失败'))
  await render(<InventoryAgingPage />)
  expect(host.textContent).toContain('存放明细加载失败')
  expect(visibleText()).not.toContain('暂无库存数据')
  await click('刷新')
  expect(getExpiryAlertsApi).not.toHaveBeenCalled()
})
it('效期失败单独提示，缓存库龄汇总仍可见', async () => {
  vi.mocked(getInventoryAgingApi).mockResolvedValue({ buckets: [{ bucket: '90+', skuCount: 1, totalQty: 2, totalValue: 400 }], list: [], pagination: { page: 1, pageSize: 500, total: 0 }, staleDays: 90 })
  vi.mocked(getExpiryAlertsApi).mockRejectedValue(new Error('测试效期失败'))
  await render(<InventoryAgingPage />)
  await click('效期预警')
  expect(host.textContent).toContain('效期预警加载失败')
  expect(host.textContent).toContain('¥400.00')
  expect(visibleText()).not.toContain('暂无临期 / 过期批次')
})
