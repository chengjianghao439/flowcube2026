// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useDashboardSummary, usePdaPerformance, useWarehouseOps, usePendingApprovalsBrief } from './useDashboard'
import { getDashboardSummaryApi } from '@/api/dashboard'
import { getPdaPerformanceApi, getWarehouseOpsApi } from '@/api/reports'
import { listPendingApprovalsApi } from '@/api/approvals'

vi.mock('@/api/dashboard', () => ({ getDashboardSummaryApi: vi.fn(async () => ({})) }))
vi.mock('@/api/reports', () => ({ getPdaPerformanceApi: vi.fn(async () => ({})), getWarehouseOpsApi: vi.fn(async () => ({})) }))
vi.mock('@/api/approvals', () => ({ listPendingApprovalsApi: vi.fn(async () => ({})) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

for (const [name, hook, request, key] of [
  ['summary', useDashboardSummary, getDashboardSummaryApi, 'dashboard-summary'],
  ['performance', usePdaPerformance, getPdaPerformanceApi, 'pda-performance'],
  ['warehouse', useWarehouseOps, getWarehouseOpsApi, 'dash-warehouse-ops'],
  ['approvals', usePendingApprovalsBrief, listPendingApprovalsApi, 'dash-pending-approvals'],
] as const) {
  test(`${name}: 隐藏工作区停止轮询和失效刷新，恢复后继续使用同一个 queryKey`, async () => {
    vi.useFakeTimers()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const host = document.createElement('div')
    const root = createRoot(host)
    let navigate!: NavigateFunction
    function Consumer() { hook(); return null }
    function Harness({ section }: { section: boolean }) {
      navigate = useNavigate()
      return <TabPathContext.Provider value="/dashboard"><SectionVisibilityContext.Provider value={section}><Consumer /></SectionVisibilityContext.Provider></TabPathContext.Provider>
    }
    const render = async (section = true) => act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/dashboard']}><Harness section={section} /></MemoryRouter></QueryClientProvider>))
    try {
      expect(document.hidden).toBe(false)
      await render()
      expect(request).toHaveBeenCalledTimes(1)
      await act(async () => navigate('/sale'))
      await act(async () => vi.advanceTimersByTimeAsync(120_000))
      await act(async () => { await client.invalidateQueries({ queryKey: [key] }) })
      expect(request).toHaveBeenCalledTimes(1)
      await act(async () => navigate('/dashboard'))
      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      expect(vi.mocked(request).mock.calls.length).toBeGreaterThan(1)
      const resumedCalls = vi.mocked(request).mock.calls.length
      await render(false)
      await act(async () => vi.advanceTimersByTimeAsync(120_000))
      expect(request).toHaveBeenCalledTimes(resumedCalls)
      expect(client.getQueryCache().getAll().map(query => query.queryKey)).toEqual([[key]])
    } finally { await act(async () => root.unmount()); client.clear() }
  })
}

test('相同 key 的可见消费者共享请求，隐藏其中一个不影响另一个轮询', async () => {
  vi.useFakeTimers()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRoot(document.createElement('div'))
  function Consumer() { useDashboardSummary(); return null }
  const render = async (first: boolean, second: boolean) => act(async () => root.render(
    <QueryClientProvider client={client}><MemoryRouter initialEntries={['/dashboard']}>
      <SectionVisibilityContext.Provider value={first}><Consumer /></SectionVisibilityContext.Provider>
      <SectionVisibilityContext.Provider value={second}><Consumer /></SectionVisibilityContext.Provider>
    </MemoryRouter></QueryClientProvider>,
  ))
  try {
    await render(true, true)
    expect(getDashboardSummaryApi).toHaveBeenCalledTimes(1)
    await render(false, true)
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(getDashboardSummaryApi).toHaveBeenCalledTimes(2)
    await render(false, false)
    await act(async () => vi.advanceTimersByTimeAsync(120_000))
    expect(getDashboardSummaryApi).toHaveBeenCalledTimes(2)
    expect(client.getQueryCache().getAll()).toHaveLength(1)
  } finally { await act(async () => root.unmount()); client.clear() }
})
