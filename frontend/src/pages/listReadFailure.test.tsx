// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import PurchasePage from './purchase'
import ReturnsPage from './returns'
import RefundsPage from './refunds'

const fixture = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/api/purchase', async original => ({ ...await original<typeof import('@/api/purchase')>(), getPurchaseListApi: fixture.list }))
vi.mock('@/api/returns', async original => ({ ...await original<typeof import('@/api/returns')>(), getPurchaseReturnsApi: fixture.list, getSaleReturnsApi: fixture.list }))
vi.mock('@/api/refund', async original => ({ ...await original<typeof import('@/api/refund')>(), getRefundListApi: fixture.list }))
vi.mock('@/api/finance', async original => ({ ...await original<typeof import('@/api/finance')>(), getActiveAccountsApi: async () => [] }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/components/print/OrderPrintOverlay', () => ({ OrderPrintOverlay: () => null }))
vi.mock('./purchase/PurchaseQueryDialog', () => ({ default: () => null }))
vi.mock('./returns/ReturnQueryDialog', () => ({ default: () => null }))
vi.mock('./refunds/RefundQueryDialog', () => ({ default: () => null }))

const samples = [
  { path: '/purchase?keyword=保留筛选', Component: PurchasePage, prefix: 'purchase' },
  { path: '/returns/purchase?keyword=保留筛选', Component: ReturnsPage, prefix: 'returns' },
  { path: '/returns/sale?keyword=保留筛选', Component: ReturnsPage, prefix: 'returns' },
  { path: '/refunds', Component: RefundsPage, prefix: 'refund-orders' },
]
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixture.list.mockReset() })
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }

async function page(sample: typeof samples[number], run: (host: HTMLDivElement, cache: QueryClient) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[sample.path]}><sample.Component /></MemoryRouter></QueryClientProvider>))
    await flush()
    await run(host, cache)
  } finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
}

test.each(samples)('$path 首次读取失败显示持续错误和重试，不显示空数据或零总数', async sample => {
  fixture.list.mockRejectedValue(new Error('读取失败夹具'))
  await page(sample, async host => {
    expect(host.textContent).toContain('读取失败夹具')
    expect(host.textContent).not.toContain('暂无数据')
    expect(host.textContent).not.toMatch(/共\s*0\s*单/)
    const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重试')
    expect(retry).toBeTruthy()
    const previousParams = fixture.list.mock.calls.at(-1)?.[0]
    fixture.list.mockResolvedValue({ list: [], pagination: { total: 0 } })
    await act(async () => retry!.click()); await flush()
    expect(fixture.list.mock.calls.at(-1)?.[0]).toEqual(previousParams)
    expect(host.textContent).not.toContain('读取失败夹具')
    expect(host.textContent).toContain('暂无数据')
    expect(host.textContent).toMatch(/共\s*0\s*单/)
  })
})

test.each(samples)('$path 缓存数据刷新失败不把旧数据和旧汇总继续当当前结果', async sample => {
  fixture.list.mockResolvedValue({ list: [{ id: 7, orderNo: '旧缓存单', returnNo: '旧缓存单', refundNo: '旧缓存单', status: 1, statusName: '草稿', amount: 1 }], pagination: { total: 1 } })
  await page(sample, async (host, cache) => {
    expect(host.textContent).toContain('旧缓存单')
    fixture.list.mockRejectedValue(new Error('刷新失败夹具'))
    await act(async () => { await cache.refetchQueries({ queryKey: [sample.prefix] }) }); await flush()
    expect(host.textContent).toContain('刷新失败夹具')
    expect(host.textContent).not.toContain('旧缓存单')
    expect(host.textContent).not.toMatch(/共\s*1\s*单/)
    expect([...host.querySelectorAll('button')].some(button => button.textContent === '重试')).toBe(true)
  })
})
