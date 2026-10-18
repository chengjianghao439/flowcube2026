// @vitest-environment jsdom
// 真实页面→hooks→accounting API；mockAxios封住全部网络方法，未列明请求必失败。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LedgerPage from './index'

const mockAxios = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), unknown: [] as string[] }))
vi.mock('@/api/client', () => ({ payloadClient: mockAxios }))

let host: HTMLDivElement, root: Root, client: QueryClient, voucherDate: string
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); mockAxios.unknown.length = 0
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) mockAxios[method].mockReset().mockImplementation(async (url: string) => { mockAxios.unknown.push(`${method} ${url}`); throw Error('禁止未列明离线请求') })
  mockAxios.get.mockImplementation(async (url: string) => {
    if (/^\/accounting\/ledger\/trial-balance\?period=\d{6}$/.test(url)) return {
      list: [{ accountId: 7, code: '1001', name: '合成现金科目', category: 1, categoryName: '资产', balanceDir: 1, level: 1, isLeaf: true, openingDebit: 0, openingCredit: 0, periodDebit: 100, periodCredit: 0, closingDebit: 100, closingCredit: 0 }], balanced: { period: true, closing: true },
    }
    if (/^\/accounting\/ledger\/account\/7\?period=\d{6}$/.test(url)) return {
      openingBalance: 0, closingBalance: 100,
      list: [{ voucherId: 71, voucherNo: 'OFFLINE-DATE-71', voucherDate, summary: '合成日期验收', auxName: null, debit: 100, credit: 0, balance: 100 }],
    }
    mockAxios.unknown.push(`get ${url}`); throw Error('禁止未列明离线GET')
  })
})
afterEach(() => {
  act(() => root.unmount()); client.clear(); host.remove(); localStorage.clear()
  expect(mockAxios.unknown).toEqual([])
  for (const method of ['post', 'put', 'patch', 'delete'] as const) expect(mockAxios[method]).not.toHaveBeenCalled()
})

it.each([
  ['ISO北京午夜', '2026-10-15T16:00:00.000Z', '2026-10-16'],
  ['plain YMD', '2026-10-16', '2026-10-16'],
])('明细账%s显示北京业务日期，不截UTC前缀', async (_name, raw, expected) => {
  voucherDate = raw
  await act(async () => root.render(<QueryClientProvider client={client}><LedgerPage /></QueryClientProvider>))
  await vi.waitFor(() => expect(host.textContent).toContain('合成现金科目'))
  const open = host.querySelector<HTMLButtonElement>('button[title="查看明细账"]')!
  await act(async () => open.click())
  await vi.waitFor(() => expect(document.body.textContent).toContain('OFFLINE-DATE-71'))
  const row = [...document.querySelectorAll('tr')].find(r => r.textContent?.includes('OFFLINE-DATE-71'))!
  expect(row.cells[0].textContent).toBe(expected)
  expect(row.cells[3].textContent).toBe('100.00')
  expect(row.cells[5].textContent).toBe('100.00')
  expect(voucherDate).toBe(raw)
})
