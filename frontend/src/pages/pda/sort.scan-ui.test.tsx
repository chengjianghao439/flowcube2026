// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaSortPage from './sort'

const api = vi.hoisted(() => ({ product: vi.fn(), error: vi.fn() }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
}))
vi.mock('@/api/sorting-bins', () => ({ scanProductForSortApi: api.product, getSortingBinsApi: vi.fn() }))
vi.mock('@/hooks/useCriticalPdaAction', () => ({
  useCriticalPdaAction: () => ({ submitBlocked: false, networkStatus: 'online' }),
}))
vi.mock('@/components/pda/PdaCriticalActionNotice', () => ({ default: () => null }))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({ flash: null, ok: vi.fn(), err: api.error, warn: vi.fn() }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.product.mockReset().mockResolvedValue({
    sortingBinCode: 'B01', productCode: 'P001', productName: '测试商品',
    pickedQty: 2, unit: '个', taskNo: 'WT001', customerName: '客户', taskId: 7, itemId: 8,
  })
  api.error.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test('分拣页的手输入口与拣货一致，并送入原分拣扫码流程', async () => {
  await act(async () => { root.render(<MemoryRouter><PdaSortPage /></MemoryRouter>) })
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
  const manualButton = [...host.querySelectorAll('button')].find(button => button.textContent === '手动输入')
  expect(manualButton).not.toBeUndefined()
  await act(async () => { manualButton!.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'P001')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(api.product).toHaveBeenCalledWith('P001')
  expect(host.textContent).toContain('请将以下商品放入指定分拣格')
})

test('扫码遇到未分配分拣格时提示联系主管并刷新重扫', async () => {
  api.product.mockResolvedValueOnce({
    sortingBinCode: null, productCode: 'P001', productName: '测试商品',
    pickedQty: 2, unit: '个', taskNo: 'WT001', customerName: '客户', taskId: 7, itemId: 8,
  })
  await act(async () => { root.render(<MemoryRouter><PdaSortPage /></MemoryRouter>) })
  const manualButton = [...host.querySelectorAll('button')].find(button => button.textContent === '手动输入')!
  await act(async () => { manualButton.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'P001')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(api.error).toHaveBeenCalledWith(expect.stringContaining('联系主管'))
  expect(api.error.mock.calls[0][0]).toContain('刷新')
  expect(host.textContent).not.toContain('请将以下商品放入指定分拣格')
})
