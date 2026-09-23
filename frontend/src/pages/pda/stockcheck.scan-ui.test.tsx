// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaStockcheckPage from './stockcheck'

const inventory = vi.hoisted(() => ({ container: vi.fn() }))
vi.mock('@/api/inventory', () => ({ getContainerByBarcodeApi: inventory.container }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({
    data: {
      checkNo: 'PD001', warehouseName: '主仓', items: [{
        id: 7, productId: 3, productCode: 'P000003', productName: '测试商品',
        bookQty: 2, unit: '个', bookContainerCount: 1, actualQty: null,
        scans: [], scannedContainerCount: 0,
      }],
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/hooks/useCriticalPdaAction', () => ({
  useCriticalPdaAction: () => ({ submitBlocked: false, phase: 'idle', run: vi.fn() }),
}))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => false }))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({ flash: null, ok: vi.fn(), err: vi.fn() }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  inventory.container.mockReset().mockResolvedValue({
    barcode: 'I000007', productId: 3, containerStatus: 'stored', individual: false, remainingQty: 2,
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test('盘点条码入口与拣货一致，选商品后点手动输入才出现条码框', async () => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/pda/stockcheck/1']}>
      <Routes><Route path="/pda/stockcheck/:id" element={<PdaStockcheckPage />} /></Routes>
    </MemoryRouter>)
  })
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent?.includes('测试商品'))!.click() })
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
  const manualButton = [...host.querySelectorAll('button')].find(button => button.textContent === '手动输入')
  expect(manualButton).not.toBeUndefined()
  await act(async () => { manualButton!.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')!
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'I000007')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(inventory.container).toHaveBeenCalledWith('I000007')
  expect(host.textContent).toContain('已扫条码（1）')
})
