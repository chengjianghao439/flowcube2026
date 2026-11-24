// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TransferFormPage from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import type { TransferOrder } from '@/api/transfer'

const api = vi.hoisted(() => ({ detail: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('@/api/transfer', async original => ({
  ...await original<typeof import('@/api/transfer')>(),
  getTransferDetailApi: api.detail,
  createTransferApi: api.create,
  updateTransferApi: api.update,
}))
vi.mock('@/hooks/useWarehouses', () => ({
  useWarehousesActive: () => ({ data: [{ id: 1, name: '一仓' }, { id: 2, name: '二仓' }] }),
}))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => false }))
vi.mock('@/components/finder', () => ({ ProductFinder: () => null }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/hooks/useWorkspaceTabTitle', () => ({ useWorkspaceTabTitle: () => {} }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const order: TransferOrder = {
  id: 7, orderNo: 'TR-7', status: 1, statusName: '草稿', fromWarehouseId: 1, fromWarehouseName: '一仓', toWarehouseId: 2, toWarehouseName: '二仓', operatorName: '测试员', createdAt: '2026-11-25',
  items: [{ id: 30, productId: 40, productCode: 'P40', productName: '测试商品', unit: '个', quantity: 2 }],
}
let host: HTMLDivElement, root: Root, query: QueryClient
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  api.detail.mockReset().mockResolvedValue(order)
  api.create.mockReset()
  api.update.mockReset().mockResolvedValue(order)
  sessionStorage.clear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  query.clear()
  host.remove()
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null })
  vi.unstubAllGlobals()
})
const render = (path = '/transfer/new') => act(async () => root.render(
  <QueryClientProvider client={query}>
    <MemoryRouter initialEntries={[path]}><TabPathContext.Provider value={path}><TransferFormPage /></TabPathContext.Provider></MemoryRouter>
  </QueryClientProvider>,
))
const button = (label: string) => [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!
const click = (label: string) => act(async () => button(label).click())
const reason = (control: HTMLElement) => document.getElementById(control.getAttribute('aria-describedby')!)?.textContent
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('调拨新建的缺失仓库在各字段旁提示并聚焦调出仓', async () => {
  await render()
  await click('保存草稿')
  const from = host.querySelector<HTMLElement>('[data-entry-field="from"] button[role="combobox"]')!
  const to = host.querySelector<HTMLElement>('[data-entry-field="to"] button[role="combobox"]')!
  expect(document.activeElement).toBe(from)
  expect(from.getAttribute('aria-invalid')).toBe('true')
  expect(reason(from)).toBe('请选择调出仓库')
  expect(reason(to)).toBe('请选择调入仓库')
  expect(api.create).not.toHaveBeenCalled()
})

test.each([
  { patch: { toWarehouseId: 1, toWarehouseName: '一仓' }, selector: '[data-entry-field="to"] button[role="combobox"]', message: '与调出仓库不能相同' },
  { patch: { items: [] }, selector: '[data-entry-field="add"] button', message: '请添加至少一条明细' },
])('采购建议带入后仍在原字段反馈 $message', async ({ patch, selector, message }) => {
  const key = 'procurement-transfer-test'
  sessionStorage.setItem(key, JSON.stringify({ ...order, ...patch }))
  await render('/transfer/new?procurement=' + key)
  await click('保存草稿')
  const control = host.querySelector<HTMLElement>(selector)!
  expect(document.activeElement).toBe(control)
  expect(reason(control)).toBe(message)
  expect(api.create).not.toHaveBeenCalled()
})

test('编辑时整数数量错误显示在明细，修正后按原单保存', async () => {
  await render('/transfer/7')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  await click('编辑')
  const quantity = host.querySelector<HTMLInputElement>('input[placeholder="数量"]')!
  await fill(quantity, '2.5')
  await click('保存修改')
  expect(document.activeElement).toBe(quantity)
  expect(reason(quantity)).toBe('该商品数量只能是整数')
  expect(api.update).not.toHaveBeenCalled()
  await fill(quantity, '3')
  expect(quantity.getAttribute('aria-invalid')).not.toBe('true')
  await click('保存修改')
  expect(api.update.mock.calls[0]).toMatchObject([7, { fromWarehouseId: 1, toWarehouseId: 2, items: [{ productId: 40, quantity: 3 }] }])
})
