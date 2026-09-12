// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import KpiPage from './kpi'
import { getKpiApi } from '@/api/reports'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
vi.mock('@/api/reports', () => ({ getKpiApi: vi.fn() }))
// Chart dimensions are a browser concern; these tests cover query state and actual table cells.
vi.mock('recharts', async original => ({ ...await original<object>(), ResponsiveContainer: () => null }))
const report = {
  period: '2026-09', prevPeriod: '2026-08',
  metrics: [{ key: 'gmv', label: '销售净额', current: 100, previous: 80, changePct: 25 }],
  trend: [{ month: '2026-09', gmv: 100, grossProfit: 30, orderCount: 2, received: 50, avgOrderValue: 50 }],
  byWarehouse: [
    { warehouseId: 1, warehouseName: 'KPI-A仓', gmv: 60, grossProfit: -10, orderCount: 1, avgOrderValue: 60 },
    { warehouseId: 2, warehouseName: 'KPI-B仓', gmv: 40, grossProfit: 40, orderCount: 1, avgOrderValue: 40 },
  ],
}
let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); localStorage.clear() })
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
async function render(active = true) {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><SectionVisibilityContext.Provider value={active}><KpiPage /></SectionVisibilityContext.Provider></QueryClientProvider></MemoryRouter>))
  await settle()
}
async function refresh() {
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '立即刷新')!.click())
  await settle()
}
it('分仓占比按全部仓库销售净额计算，负毛利不显示成功色', async () => {
  vi.mocked(getKpiApi).mockResolvedValue(report)
  await render()
  expect(host.textContent).toContain('60.0%')
  expect(host.textContent).toContain('40.0%')
  expect(host.textContent).not.toContain('100.0%')
  expect([...host.querySelectorAll('.text-destructive')].some(el => el.textContent?.includes('-10'))).toBe(true)
})
it('刷新失败保留趋势和分仓明细并警示，恢复后警示消失', async () => {
  vi.mocked(getKpiApi).mockResolvedValueOnce(report).mockRejectedValue(new Error('KPI 刷新失败'))
  await render(); await refresh()
  expect(host.textContent).toContain('刷新失败，当前显示上次成功的数据')
  expect(host.textContent).toContain('近 12 个月经营趋势')
  expect(host.textContent).toContain('KPI-A仓')
  vi.mocked(getKpiApi).mockResolvedValue(report)
  await refresh()
  expect(host.textContent).not.toContain('刷新失败，当前显示上次成功的数据')
})
it('首次失败显示重试，不显示暂无分仓或零值占位', async () => {
  vi.mocked(getKpiApi).mockRejectedValue(new Error('KPI 加载失败'))
  await render()
  expect(host.textContent).toContain('经营 KPI加载失败')
  expect(host.textContent).not.toContain('该月暂无分仓数据')
  expect(host.textContent).not.toContain('¥0.00')
})
it('隐藏的经营页不发起或被失效通知触发查询，打开后才读取', async () => {
  vi.mocked(getKpiApi).mockResolvedValue(report)
  await render(false)
  await act(async () => client.invalidateQueries({ queryKey: ['reports-kpi'] }))
  expect(getKpiApi).not.toHaveBeenCalled()
  await render(true)
  expect(getKpiApi).toHaveBeenCalledTimes(1)
})
it('零销售净额时分仓占比为零，不产生NaN', async () => {
  vi.mocked(getKpiApi).mockResolvedValue({ ...report, byWarehouse: report.byWarehouse.map(r => ({ ...r, gmv: 0 })) })
  await render()
  expect(host.textContent).toContain('0.0%')
  expect(host.textContent).not.toContain('NaN')
})
