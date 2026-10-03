// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaCancelReturnPage from './cancel-return'
import PdaAdjustmentPage from './adjustment'
import { useAuthStore } from '@/store/authStore'
import type { CancelReturnDetail } from '@/api/warehouse-tasks'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), defaults: { baseURL: '/fixture' } }))
vi.mock('@/api/client', () => ({
  default: { defaults: mocks.defaults },
  payloadClient: { get: mocks.get, post: mocks.post },
}))
const cancelDetail: CancelReturnDetail = {
  id: 1, taskNo: 'WT001', status: 2, cancelRequestedAt: '2026-10-01',
  warehouseId: 1, warehouseName: '测试仓', customerName: 'fixture',
  containers: [{
    containerId: 7, productId: 3, barcode: 'I000007', productName: '测试商品', qty: 1,
    suggestedLocationCode: 'A01', containerKind: 'inventory', zone: null,
    aisle: null, rack: null, level: null, position: null,
  }], packages: [],
}
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
let qc: QueryClient

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear()
  localStorage.clear()
  vi.resetAllMocks()
  useAuthStore.getState().login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/warehouse-tasks/1/cancel-return-detail') return cancelDetail
    if (url === '/locations/code/A01') return { id: 6, code: 'A01' }
    throw new Error(`Unexpected fixture GET ${url}`)
  })
  mocks.post.mockResolvedValue({ id: 101, remaining: 0, packagesRemaining: 0, finalized: false })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  qc.clear()
  useAuthStore.getState().logout()
  host.remove()
})

test.each([
  ['/pda/cancel-return/1', 'I000007', 'A01'],
  ['/pda/adjustments/2', 'I000009', 'A02'],
])('%s 点手动输入后沿用扫码归还流程', async (path, barcode, location) => {
  await renderPath(path)
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
  await manualInput(barcode)
  expect(host.textContent).toContain(location)
  expect(host.textContent).toContain('扫描原库位条码确认放回')
  if (path === '/pda/cancel-return/1') {
    expect(mocks.get).toHaveBeenCalledWith('/warehouse-tasks/1/cancel-return-detail', expect.objectContaining({ baseURL: '/fixture' }))
    await manualInput(location)
    expect(mocks.get).toHaveBeenCalledWith('/locations/code/A01', expect.objectContaining({ baseURL: '/fixture' }))
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(mocks.post).toHaveBeenCalledWith('/scan-logs/cancel-return', {
      taskId: 1, containerId: 7, barcode: 'I000007', locationId: 6,
    }, expect.objectContaining({
      baseURL: '/fixture', _authSessionGeneration: useAuthStore.getState().sessionGeneration,
      headers: expect.objectContaining({ 'X-Client': 'pda', 'X-Request-Key': expect.any(String) }),
    }))
  }
})

async function renderPath(path: string) {
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
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
}
async function manualInput(value: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === '手动输入')
  expect(button).not.toBeUndefined()
  expect(button!.disabled).toBe(false)
  await act(async () => { button!.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')
  expect(input).toBeInstanceOf(HTMLInputElement)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 5)) })
}
test('owned cancel detail loading never exposes manual scanner or submits', async () => {
  mocks.get.mockImplementation(() => new Promise(() => {}))
  await renderPath('/pda/cancel-return/1')
  expect(mocks.get).toHaveBeenCalledWith('/warehouse-tasks/1/cancel-return-detail', expect.objectContaining({ baseURL: '/fixture' }))
  expect(host.querySelector('[data-testid="pda-scan-area"]')).toBeNull()
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
  expect(mocks.post).not.toHaveBeenCalled()
})
test('missing login never bypasses owned detail read or exposes manual scanner', async () => {
  useAuthStore.getState().logout()
  await renderPath('/pda/cancel-return/1')
  expect(mocks.get).not.toHaveBeenCalled()
  expect(host.querySelector('[data-testid="pda-scan-area"]')).toBeNull()
  expect(mocks.post).not.toHaveBeenCalled()
})
