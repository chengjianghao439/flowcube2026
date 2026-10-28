// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import WavePerformancePage from './wave-performance'
import PdaAnomalyPage from './pda-anomaly'
import { getWavePerformanceApi, getPdaAnomalyApi } from '@/api/reports'

vi.mock('@/api/reports', () => ({ getWavePerformanceApi: vi.fn(), getPdaAnomalyApi: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
let host: HTMLDivElement, root: Root, cache: QueryClient
const wave = { waves: [], summary: { totalWaves: 0, completedWaves: 0, avgDurationMinutes: null, avgSkuCount: null, totalPickedQty: 0 } }
const anomaly = { summary: { totalScans: 0, totalErrors: 0, totalUndos: 0, errorRate: '0%' }, dailyTrend: [], byOperator: [], undoByOperator: [], byReason: [], byBarcode: [] }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks(); localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove() })
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
async function render(page: ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={cache}>{page}</QueryClientProvider>)); await settle()
}
test('批次成功空结果仍保留表头与原排序入口', async () => {
  vi.mocked(getWavePerformanceApi).mockResolvedValue(wave)
  await render(<WavePerformancePage />)
  expect(host.querySelector('thead')?.textContent).toContain('批次号')
  expect(host.querySelector('thead')?.textContent).toContain('任务数')
  expect(host.querySelector('button[aria-label="按任务数排序"]')).not.toBeNull()
  expect(host.querySelector('tbody')?.textContent).toContain('当前筛选范围内没有批次记录')
})
test('批次空结果后刷新失败不继续声称当前为空', async () => {
  vi.mocked(getWavePerformanceApi).mockResolvedValueOnce(wave).mockRejectedValue(new Error('合成批次读取失败'))
  await render(<WavePerformancePage />)
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '立即刷新')!.click()); await settle()
  expect(host.textContent).toContain('批次效率加载失败')
  expect(host.querySelector('tbody')).toBeNull()
  expect(host.textContent).not.toContain('当前筛选范围内没有批次记录')
})
test('PDA五类空统计说明当前筛选范围，不推断全部正常；失败不展示空统计', async () => {
  vi.mocked(getPdaAnomalyApi).mockResolvedValueOnce(anomaly).mockRejectedValue(new Error('合成异常统计读取失败'))
  await render(<PdaAnomalyPage />)
  const descriptions = [...host.querySelectorAll('.fc-empty-state-description')].map(node => node.textContent)
  expect(descriptions).toHaveLength(5)
  expect(descriptions.every(text => text === '当前筛选范围内暂无统计数据')).toBe(true)
  expect(host.textContent).not.toContain('全部正常')
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '立即刷新')!.click()); await settle()
  expect(host.textContent).toContain('PDA 异常分析加载失败')
  expect(host.querySelector('.fc-report-panel')).toBeNull()
})

test.each([
  { label: '创建日期', Page: WavePerformancePage, api: getWavePerformanceApi, result: wave },
  { label: '异常日期', Page: PdaAnomalyPage, api: getPdaAnomalyApi, result: anomaly },
])('$label 刷新只重读已应用范围，保留未应用日期草稿', async ({ label, Page, api, result }) => {
  // 两页真实查询和日期组件，仅 API 只读边界为合成数据。
  vi.mocked(api).mockResolvedValue(result as never)
  await render(<Page />)
  const applied = { ...vi.mocked(api).mock.calls[0][0] }
  const start = host.querySelector<HTMLInputElement>(`input[aria-label="${label}（起）"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(start, '2026-01-02')
    start.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => start.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  const refresh = [...host.querySelectorAll('button')].filter(button => button.textContent === '立即刷新')
  expect(refresh).toHaveLength(1)
  const before = vi.mocked(api).mock.calls.length
  await act(async () => refresh[0].click()); await settle()
  expect(vi.mocked(api).mock.calls).toHaveLength(before + 1)
  expect(vi.mocked(api).mock.lastCall?.[0]).toEqual(applied)
  expect(start.value).toBe('2026-01-02')
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '查询')!.click()); await settle()
  expect(vi.mocked(api).mock.lastCall?.[0]).toEqual({ ...applied, startDate: '2026-01-02' })
})
