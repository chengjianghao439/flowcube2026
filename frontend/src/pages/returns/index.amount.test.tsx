// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import ReturnsPage from './index'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/api/returns', () => ({ getSaleReturnsApi: mocks.list, getPurchaseReturnsApi: mocks.list,
  confirmSaleReturnApi: vi.fn(), cancelSaleReturnApi: vi.fn(), confirmPurchaseReturnApi: vi.fn(), cancelPurchaseReturnApi: vi.fn() }))
vi.mock('./ReturnQueryDialog', () => ({ default: () => null }))
vi.mock('@/components/print/OrderPrintOverlay', () => ({ OrderPrintOverlay: () => null }))

async function page(path: string, rows: object[], check: (host: HTMLElement) => void) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.list.mockResolvedValue({ list: rows, pagination: { total: rows.length } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><ReturnsPage /></MemoryRouter></QueryClientProvider>))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    check(host)
  } finally {
    await act(async () => { root.unmount(); await new Promise(r => setTimeout(r, 5)) })
    cache.clear()
    host.remove()
  }
}

test('来源退货列表直接显示本单四位净额，按状态解释预计与实际，不把半分钱显示成一分钱', async () => {
  await page('/returns/sale', [
    { id: 1, returnNo: 'SR1', commercialModel: 'kit-v1', totalAmount: 0.005, status: 3, statusName: '已执行' },
    { id: 2, returnNo: 'SR2', commercialModel: 'kit-v1', totalAmount: 0, status: 2, statusName: '已确认' },
    { id: 3, returnNo: 'SR3', commercialModel: 'kit-v1', totalAmount: 10000.005, status: 1, statusName: '草稿' },
    { id: 4, returnNo: 'SR4', commercialModel: 'kit-v1', totalAmount: 0.005, status: 4, statusName: '已取消' },
  ], host => {
    expect(host.textContent).toContain('¥0.0050')
    expect(host.textContent).toContain('¥0.0000')
    expect(host.textContent).toContain('¥10000.0050')
    expect(host.querySelector('[title="本单实际净冲减"]')?.textContent).toBe('¥0.0050')
    expect(host.querySelectorAll('[title="预计最多冲减；合格入仓完成后确定实际净额"]')).toHaveLength(2)
    expect(host.querySelector('[title="已取消退货单原金额"]')?.textContent).toBe('¥0.0050')
  })
})

test('普通销售与采购退货保持原两位金额格式', async () => {
  for (const path of ['/returns/sale', '/returns/purchase']) {
    await page(path, [{ id: 1, returnNo: 'R1', totalAmount: 12345.005, status: 3, statusName: '已执行' }], host => {
      expect(host.textContent).toContain('¥12,345.01')
      expect(host.querySelector('[title="本单实际净冲减"]')).toBeNull()
    })
  }
})
