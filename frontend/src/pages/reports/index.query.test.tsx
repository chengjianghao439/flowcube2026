// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, getByRole } from '@testing-library/dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getPurchaseStatsApi } from '@/api/reports'
import { todayYmd } from '@/lib/dateTime'
import ReportsPage from './index'

vi.mock('@/api/reports', () => ({
  getPurchaseStatsApi: vi.fn(),
  getSaleStatsApi: vi.fn(),
  getInventoryStatsApi: vi.fn(),
  getPurchasePriceTrendApi: vi.fn(),
}))

let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.mocked(getPurchaseStatsApi).mockReset().mockImplementation(() => new Promise(() => {}))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(<MemoryRouter initialEntries={['/reports']}><QueryClientProvider client={client}><ReportsPage /></QueryClientProvider></MemoryRouter>))
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals() })

const dates = () => [...host.querySelectorAll('input')] as HTMLInputElement[]
const button = (name: string) => getByRole(host, 'button', { name })

test('初次读取的北京时间区间同时显示在起止输入和已应用提示', async () => {
  const day = todayYmd()
  expect(getPurchaseStatsApi).toHaveBeenCalledExactlyOnceWith({ startDate: day, endDate: day })
  expect(dates().map(input => input.value)).toEqual([day, day])
  expect(host.textContent).toContain(`已应用日期：${day} 至 ${day}`)
  expect(getByRole(host, 'textbox', { name: '开始日期' })).toBe(dates()[0])
  expect(getByRole(host, 'textbox', { name: '结束日期' })).toBe(dates()[1])
})

test('保留非法日期供修正，查询只应用合法日期，重置仍明确查询不限日期', async () => {
  const day = todayYmd()
  const start = dates()[0]
  await act(async () => { fireEvent.change(start, { target: { value: '2026-02-31' } }); fireEvent.focusOut(start) })
  expect(start.value).toBe('2026-02-31')
  expect(start.getAttribute('aria-invalid')).toBe('true')
  const invalid = new Event('invalid', { cancelable: true })
  await act(async () => { start.dispatchEvent(invalid) })
  expect(invalid.defaultPrevented).toBe(true)
  expect(getByRole(host, 'alert').textContent).toContain('请输入有效日期')
  await act(async () => { button('查询').click() })
  expect(getPurchaseStatsApi).toHaveBeenCalledExactlyOnceWith({ startDate: day, endDate: day })
  expect(host.textContent).toContain(`已应用日期：${day} 至 ${day}`)

  await act(async () => { fireEvent.change(start, { target: { value: '2025-1-2' } }); fireEvent.focusOut(start) })
  expect(start.value).toBe('2025-01-02')
  expect(getPurchaseStatsApi).toHaveBeenCalledTimes(1)
  await act(async () => { button('查询').click() })
  expect(getPurchaseStatsApi).toHaveBeenLastCalledWith({ startDate: '2025-01-02', endDate: day })
  expect(host.textContent).toContain(`已应用日期：2025-01-02 至 ${day}`)

  await act(async () => { fireEvent.change(start, { target: { value: '2025-02-31' } }); fireEvent.focusOut(start) })
  await act(async () => { button('重置').click() })
  expect(getPurchaseStatsApi).toHaveBeenLastCalledWith({ startDate: '', endDate: '' })
  expect(dates().map(input => input.value)).toEqual(['', ''])
  expect(host.textContent).toContain('已应用日期：不限')
})
