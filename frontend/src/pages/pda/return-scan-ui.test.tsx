// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaCancelReturnPage from './cancel-return'
import PdaAdjustmentPage from './adjustment'

vi.mock('@/hooks/usePdaCancelReturn', () => ({
  usePdaCancelReturnDetail: () => ({
    data: { taskNo: 'WT001', containers: [{
      containerId: 7, barcode: 'I000007', productName: '测试商品', qty: 1,
      suggestedLocationCode: 'A01',
    }], packages: [] },
    isLoading: false, refetch: vi.fn(),
  }),
  usePdaPendingCancelReturns: () => ({ data: [] }),
}))
vi.mock('@/hooks/usePdaAdjustment', () => ({
  usePdaAdjustmentDetail: () => ({
    data: { taskNo: 'WT002', items: [{
      containerReturns: [{ id: 9, barcode: 'I000009', qty: 1, suggestedLocationCode: 'A02', status: 1 }],
      packageVoids: [],
    }] },
    isLoading: false, refetch: vi.fn(),
  }),
  usePdaPendingAdjustments: () => ({ data: [] }),
}))
vi.mock('@/hooks/useCriticalPdaAction', () => ({
  useCriticalPdaAction: () => ({ submitBlocked: false }),
}))
vi.mock('@/components/pda/PdaCriticalActionNotice', () => ({ default: () => null }))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({ flash: null, ok: vi.fn(), err: vi.fn(), warn: vi.fn() }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test.each([
  ['/pda/cancel-return/1', 'I000007', 'A01'],
  ['/pda/adjustments/2', 'I000009', 'A02'],
])('%s 点手动输入后沿用扫码归还流程', async (path, barcode, location) => {
  const qc = new QueryClient()
  await act(async () => {
    root.render(<QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/pda/cancel-return/:id" element={<PdaCancelReturnPage />} />
          <Route path="/pda/adjustments/:id" element={<PdaAdjustmentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>)
  })
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === '手动输入')
  expect(button).not.toBeUndefined()
  await act(async () => { button!.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, barcode)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(host.textContent).toContain(location)
  expect(host.textContent).toContain('扫描原库位条码确认放回')
})
