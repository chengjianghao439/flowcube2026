// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { getWarehouseOpsApi, type WarehouseOpsData } from '@/api/reports'
import WarehouseOpsPage from './warehouse-ops'

vi.mock('@/api/reports', () => ({ getWarehouseOpsApi: vi.fn() }))

test('看板显示真实零、具体取数失败，并于下一次轮询后恢复', async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div')
  const root = createRoot(host)
  const zero: WarehouseOpsData = {
    unavailableMetrics: [],
    summary: {
      shippedToday: 0, pickingNow: 0, inboundToday: 0, scanCount: 0,
      pickQty: 0, errorCount: 0, undoCount: 0, errorRate: '0%',
    },
    operators: [],
    flowBottleneck: [],
    hourlyTrend: [],
    recentErrors: [],
  }
  const partial: WarehouseOpsData = {
    ...zero, unavailableMetrics: ['shippedToday'], summary: { ...zero.summary, shippedToday: null },
  }
  vi.mocked(getWarehouseOpsApi).mockResolvedValueOnce(zero).mockResolvedValueOnce(partial).mockResolvedValueOnce({
    ...partial, unavailableMetrics: ['shippedToday', 'hourlyTrend'], hourlyTrend: null,
  }).mockResolvedValue(zero)

  function tileValue(label: string) {
    const item = [...host.querySelectorAll('.dashboard-stat')].find(el => el.querySelector('p')?.textContent === label)
    return item?.querySelector('[title]')?.getAttribute('title')
  }
  const bannerText = () => host.querySelector('[role="status"]')?.textContent || ''
  const tick = async (ms: number) => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2) })
  }
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/reports/warehouse-ops']}><WarehouseOpsPage /></MemoryRouter>
      </QueryClientProvider>,
    ))
    await tick(1)
    expect(tileValue('今日出库单数')).toBe('0')
    expect(bannerText()).not.toContain('暂不可用')

    await tick(60_000)
    expect(tileValue('今日出库单数')).toBe('暂不可用')
    expect(tileValue('今日扫码')).toBe('0')
    expect(bannerText()).toContain('今日出库')

    await tick(60_000)
    expect(bannerText()).toContain('今日出库、作业趋势')
    const hourly = [...host.querySelectorAll('section')].find(el => el.querySelector('h2')?.textContent === '今日作业趋势')
    expect(hourly?.textContent).toContain('暂不可用')

    await tick(60_000)
    expect(tileValue('今日出库单数')).toBe('0')
    expect(bannerText()).not.toContain('暂不可用')
    expect(getWarehouseOpsApi).toHaveBeenCalledTimes(4)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    vi.useRealTimers()
  }
})
