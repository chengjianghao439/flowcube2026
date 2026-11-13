// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import FixedAssetsPage from './index'

const api = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn() }))
vi.mock('@/api/fixedAssets', () => ({ listFixedAssetsApi: api.list, runDepreciationApi: api.run, createFixedAssetApi: vi.fn(), disposeFixedAssetApi: vi.fn() }))

test('计提本月折旧提交北京时间的月份', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  // 保留真实定时器，只固定 Date 构造的当前时间。
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-31T16:05:00Z'))
  api.list.mockResolvedValue({ list: [], pagination: { total: 0 } })
  api.run.mockResolvedValue({ ran: 0, vouchers: [] })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const qc = new QueryClient()
  try {
    await act(async () => root.render(<QueryClientProvider client={qc}><FixedAssetsPage /></QueryClientProvider>))
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === '计提本月折旧')!
    await act(async () => button.click())
    expect(api.run.mock.calls[0]?.[0]).toBe('202611')
  } finally {
    await act(async () => root.unmount())
    qc.clear()
    host.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})
