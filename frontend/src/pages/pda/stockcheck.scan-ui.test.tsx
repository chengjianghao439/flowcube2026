// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaStockcheckPage from './stockcheck'

const inventory = vi.hoisted(() => ({ container: vi.fn(), history: [] as Array<Record<string, unknown>> }))
vi.mock('@/api/inventory', () => ({ getContainerByBarcodeApi: inventory.container }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({
    data: {
      checkNo: 'PD001', warehouseName: '主仓', items: [{
        id: 7, productId: 3, productCode: 'P000003', productName: '测试商品',
        bookQty: 2, unit: '个', bookContainerCount: 1, actualQty: null,
        scans: inventory.history, scannedContainerCount: inventory.history.length,
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
  inventory.history = []
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

async function openManualInput() {
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
  return input
}

async function submitManualBarcode(input: HTMLInputElement, barcode: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, barcode)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}

test('盘点条码入口与拣货一致，选商品后点手动输入才出现条码框', async () => {
  const input = await openManualInput()
  await submitManualBarcode(input, 'I000007')
  expect(inventory.container).toHaveBeenCalledWith('I000007', { skipGlobalError: true })
  expect(host.textContent).toContain('已扫条码（1）')
  expect(input.isConnected).toBe(false)
})

test('手输盘点条码查找失败时保留输入及纠错焦点，修正后可以继续扫码', async () => {
  inventory.container.mockRejectedValueOnce(new Error('库存条码不存在'))
  const input = await openManualInput()
  await submitManualBarcode(input, 'I000099')
  expect(input.isConnected).toBe(true)
  expect(input.value).toBe('I000099')
  await vi.waitFor(() => expect(document.activeElement).toBe(input))
  expect(host.textContent).toContain('已扫条码（0）')

  await submitManualBarcode(input, 'I000007')
  expect(inventory.container).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('已扫条码（1）')
  expect(input.isConnected).toBe(false)
})

test('续扫数量容器按当前账面上限恢复，上次实盘可重新修正', async () => {
  inventory.history = [{barcode:'B17',individual:false,countedQty:0,containerBookQty:9}]
  await act(async () => { root.render(<MemoryRouter initialEntries={['/pda/stockcheck/1']}><Routes>
    <Route path="/pda/stockcheck/:id" element={<PdaStockcheckPage />} /></Routes></MemoryRouter>) })
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.includes('测试商品'))!.click() })
  const field = host.querySelector<HTMLInputElement>('[aria-label="B17 实盘数量"]')!
  expect(field.value).toBe('0')
  expect(field.max).toBe('9')
  expect(host.textContent).toContain('账面 9')
})
