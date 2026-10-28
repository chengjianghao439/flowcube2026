// @vitest-environment jsdom
// Actual pages and tables, synthetic read DTOs only; any business write fails.
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getByRole } from '@testing-library/dom'
import TransferPage from '@/pages/transfer'
import ProfitAnalysisPage from '@/pages/reports/profit-analysis'
import InventoryAgingPage from '@/pages/reports/inventory-aging'
import { PaymentQueryBar } from '@/components/shared/PaymentQueryDialog'
import { EMPTY_PAYMENT_QUERY } from '@/components/shared/paymentQuery'
import { defaultRangeYmds } from '@/lib/dateTime'
import { clearReadFixtures, lastRead, readData, writeCalls } from './readOnlyApi'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => false }) }))
vi.mock('@/api/transfer', async original => (await import('./readOnlyApi')).mockReadApi(await original(), 'transfer'))
vi.mock('@/api/reports', async original => (await import('./readOnlyApi')).mockReadApi(await original(), 'reports'))
vi.mock('@/api/inventory', async original => (await import('./readOnlyApi')).mockReadApi(await original(), 'inventory'))

let host: HTMLDivElement, root: Root, cache: QueryClient
beforeEach(() => {
  // 只固定业务日期，异步查询与 React 等待继续使用真实计时器。
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T09:00:00+08:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  clearReadFixtures()
  readData.set('transfer.getTransferListApi', { list: [], pagination: { total: 0 } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
})
afterEach(async () => {
  try {
    await act(async () => root.unmount()); cache.clear(); host.remove(); vi.unstubAllGlobals()
    expect(writeCalls).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
async function draw(node: ReactNode, path = '/') {
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
}

test.each([
  { dates: { startDate: '2026-10-01', endDate: '' }, text: '付款日期：2026-10-01 ~ 截至不限' },
  { dates: { startDate: '', endDate: '2026-10-28' }, text: '付款日期：起始不限 ~ 2026-10-28' },
])('开放日期明确边界，移除仍仅清原日期字段：$text', async ({ dates, text }) => {
  const onChange = vi.fn(), query = { ...EMPTY_PAYMENT_QUERY, ...dates, docNo: 'SYN-1', dueStart: '', dueEnd: '2026-10-31' }
  const original = structuredClone(query)
  await draw(<PaymentQueryBar query={query} onChange={onChange} labels={{ docLabel: '单号', partyLabel: '供应商', dateLabel: '付款日期', amountLabel: '金额', statusText: value => value }} />)
  expect(host.textContent).toContain(text)
  expect(host.textContent).toContain('到期日：起始不限 ~ 2026-10-31')
  expect(query).toEqual(original)
  await act(async () => getByRole(host, 'button', { name: `移除「${text}」` }).click())
  expect(onChange).toHaveBeenCalledWith({ ...query, startDate: '', endDate: '' })
})

test('调拨默认日期不显示chip，自定义范围显示真实生效值，移除回到默认范围', async () => {
  const range = defaultRangeYmds(7)
  await draw(<TransferPage />, `/transfer?startDate=${range.start}&endDate=${range.end}`)
  expect(host.querySelector('[aria-label^="移除「创建日期"]')).toBeNull()
  expect(lastRead('transfer', 'getTransferListApi')?.args[0]).toMatchObject({ startDate: range.start, endDate: range.end })
  await act(async () => root.unmount()); cache.clear(); root = createRoot(host)
  await draw(<TransferPage />, '/transfer?startDate=2026-01-01')
  const label = `创建日期：2026-01-01 ~ ${range.end}`
  expect(host.textContent).toContain(label)
  expect(lastRead('transfer', 'getTransferListApi')?.args[0]).toMatchObject({ startDate: '2026-01-01', endDate: range.end })
  await act(async () => getByRole(host, 'button', { name: `移除「${label}」` }).click())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(lastRead('transfer', 'getTransferListApi')?.args[0]).toMatchObject({ startDate: range.start, endDate: range.end })
})

test('调拨显式不限日期沿原range=all查询，不伪装默认窗口', async () => {
  await draw(<TransferPage />, '/transfer?range=all')
  expect(host.querySelector('[aria-label^="移除「创建日期"]')).toBeNull()
  expect(lastRead('transfer', 'getTransferListApi')?.args[0]).toMatchObject({ startDate: undefined, endDate: undefined })
})

test('成本快照正常行不重复说明，混合、缺失、估算及未知来源仍逐行可核', async () => {
  const sources = ['snapshot', 'mixed', 'missing', 'estimated', undefined]
  const rows = sources.map((costBasis, i) => ({ id: i + 1, orderNo: `SYN-${i}`, costAmount: i === 2 ? 0 : 123.45, totalAmount: 200, grossProfit: 76.55, marginRate: 38, costBasis, estimatedCostAmount: i === 1 ? 23.45 : 0, missingCostLineCount: i === 1 || i === 2 ? 1 : 0, path: `/sale/${i + 1}` }))
  const products = rows.map(row => ({ ...row, code: row.orderNo.replace('SYN', 'PRODUCT'), name: '合成毛利商品', revenueAmount: row.totalAmount }))
  readData.set('reports.getProfitAnalysisApi', { summary: {}, saleOrders: rows, products, stockValue: [], slowMoving: [] })
  await draw(<ProfitAnalysisPage />, '/reports/profit-analysis')
  const row = (i: number) => [...host.querySelectorAll('tbody tr')].find(el => el.textContent?.includes(`SYN-${i}`))!
  expect(row(0).textContent).not.toContain('出库时记录的成本')
  expect(row(0).textContent).toContain('123.45')
  expect(row(1).textContent).toContain('混合：1 行缺失、约 ¥23.45 按进价估算')
  expect(row(2).textContent).toContain('成本缺失（1 行按 0 计，毛利偏高）')
  expect(row(2).textContent).toContain('¥0.00')
  expect(row(3).textContent).toContain('按当前进价估算')
  expect(row(4).textContent).toContain('成本来源待核实')
  await act(async () => getByRole(host, 'button', { name: '商品毛利' }).click())
  const productRow = (i: number) => [...host.querySelectorAll('tbody tr')].find(el => el.textContent?.includes(`PRODUCT-${i}`))!
  expect(productRow(0).textContent).not.toContain('出库时记录的成本')
  expect(productRow(1).textContent).toContain('混合：1 行缺失、约 ¥23.45 按进价估算')
  expect(productRow(2).textContent).toContain('成本缺失（1 行按 0 计，毛利偏高）')
  expect(productRow(3).textContent).toContain('按当前进价估算')
  expect(productRow(4).textContent).toContain('成本来源待核实')
})

test('库龄各桶的零统一显示0，缺失保持横线，正的90天数量保留强调', async () => {
  const values = [0, null, undefined, 1.25]
  readData.set('inventory.getInventoryAgingApi', { buckets: [], list: values.map((value, i) => ({ id: i + 1, productCode: `AGE-${i}`, productName: `合成${i}`, qty0_30: value, qty30_60: value, qty60_90: value, qty90p: value, totalQty: value })) })
  await draw(<InventoryAgingPage />, '/reports/inventory-aging')
  for (let i = 0; i < values.length; i++) {
    const row = [...host.querySelectorAll('tbody tr')].find(el => el.textContent?.includes(`AGE-${i}`))!
    const cells = [...row.querySelectorAll('td')]
    const quantities = cells.filter(cell => cell.querySelector('.tabular-nums')).slice(0, 5)
    expect(quantities.map(cell => cell.textContent)).toEqual(Array(5).fill(i === 0 ? '0' : i === 3 ? '1.25' : '—'))
    if (i === 3) expect(quantities[3].querySelector('.text-amber-600')).toBeTruthy()
  }
})
