// @vitest-environment jsdom
/**
 * 改单（占库期）表头只读的真实交互回归。
 *
 * 背景：服务端改单只写商品明细与订单金额（状态机 adjust.from=[2,3,6]，文案即「修改明细」），
 * 但改单视图曾复用完整订单头表单 —— 客户/仓库/收货信息在界面上可编辑、提交返回 200 却被
 * 静默丢弃，其中改客户还会按新客户价格表重算单价并写回金额（订单客户仍是原客户）。
 *
 * 本文件不只断言 disabled 属性，而是**渲染真实 SaleFormPage 并实际点击**：
 *   ① 占库改单：点客户按钮 ⇒ 不打开选择器、不发起异客户取价；
 *   ② 占库改单：改明细仍能提交，且提交载荷归属原客户；
 *   ③ 草稿编辑（正向对照）：客户按钮仍可打开选择器（该路径本就支持改客户）。
 * 变异验证：去掉 `AdjustView` 的 `headerReadOnly` 只让用例 ① 失败——② 只改数量、
 * 与表头是否只读无关，③ 是草稿编辑的正向对照，二者在旧实现下同样通过（不据此扩大证据）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import type { SaleOrder } from '@/types/sale'
import SaleFormPage from './index'

const mocks = vi.hoisted(() => ({
  adjustSaleApi: vi.fn(),
  updateSaleApi: vi.fn(),
  getCustomerPriceApi: vi.fn(),
  getCustomersApi: vi.fn(),
  getProductApi: vi.fn(),
}))

vi.mock('@/api/sale', () => ({
  getSaleListApi: vi.fn(), getSaleDetailApi: vi.fn(), getSaleReservePreviewApi: vi.fn(),
  createSaleApi: vi.fn(), updateSaleApi: mocks.updateSaleApi, adjustSaleApi: mocks.adjustSaleApi,
  reserveSaleApi: vi.fn(), releaseSaleApi: vi.fn(), shipSaleApi: vi.fn(), cancelSaleApi: vi.fn(), deleteSaleApi: vi.fn(),
}))
vi.mock('@/api/price-lists', () => ({ getCustomerPriceApi: mocks.getCustomerPriceApi, bindCustomerApi: vi.fn() }))
vi.mock('@/api/customers', () => ({
  getCustomersApi: mocks.getCustomersApi, createCustomerApi: vi.fn(), updateCustomerApi: vi.fn(), deleteCustomerApi: vi.fn(),
}))
vi.mock('@/api/products', () => ({
  getProductApi: mocks.getProductApi, getProductsForFinderApi: vi.fn(), getProductsApi: vi.fn(),
  getProductQtyPoliciesApi: vi.fn().mockResolvedValue([]), createProductApi: vi.fn(), updateProductApi: vi.fn(),
  deleteProductApi: vi.fn(), printProductLabelApi: vi.fn(),
}))
vi.mock('@/api/carriers', () => ({
  getCarriersActiveApi: vi.fn().mockResolvedValue([]), getCarriersApi: vi.fn(), createCarrierApi: vi.fn(),
  updateCarrierApi: vi.fn(), deleteCarrierApi: vi.fn(), getCarrierAccountBindingApi: vi.fn(),
  saveCarrierAccountBindingApi: vi.fn(), createCarrierAccountApi: vi.fn(),
}))
vi.mock('@/api/warehouses', () => ({
  getWarehousesActiveApi: vi.fn().mockResolvedValue([{ id: 1, name: '示例仓库' }]),
  getWarehousesApi: vi.fn(), createWarehouseApi: vi.fn(), updateWarehouseApi: vi.fn(), deleteWarehouseApi: vi.fn(),
}))
// 不 mock「发货安排」等未访问 tab 的组件：默认 detailTab='info'，KeepAliveSection 未访问不挂载，
// 保持真实渲染面；只 mock 会发网络请求的 api 层。


let host: HTMLDivElement, root: Root, client: QueryClient

function makeOrder(status: number): SaleOrder {
  return {
    id: 12, orderNo: 'XS-12', customerId: 1, customerName: '示例客户',
    warehouseId: 1, warehouseName: '示例仓库', status, statusName: status === 2 ? '已占库' : '草稿',
    totalAmount: 500, operatorId: 1, operatorName: '经办人', createdAt: '2026-09-28',
    isMultiWarehouse: false, shippedTotalQty: 0, remark: '原备注',
    items: [{
      id: 9, productId: 9, productCode: 'P-9', productName: '示例商品',
      unit: '个', entryUnit: '个', entryQty: 5, quantity: 5, unitPrice: 100, amount: 500,
      reservedQty: 5, dispatchedQty: 0, shippedQty: 0, warehouseId: 1, warehouseName: '示例仓库', remark: '',
    }],
  } as unknown as SaleOrder
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.adjustSaleApi.mockResolvedValue({ adjustmentId: null, adjustmentNo: null, pending: false })
  mocks.updateSaleApi.mockResolvedValue(null)
  mocks.getCustomerPriceApi.mockResolvedValue({ salePrice: 10, priceLevel: 'A' })
  mocks.getCustomersApi.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 500 })
  mocks.getProductApi.mockResolvedValue({ units: [] })
  window.history.replaceState({}, '', '/#/sale/12')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['sale', 12], makeOrder(2))
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); window.history.replaceState({}, '', '/') })

function render() {
  act(() => root.render(
    <MemoryRouter><QueryClientProvider client={client}>
      <TabPathContext.Provider value="/sale/12"><SaleFormPage /></TabPathContext.Provider>
    </QueryClientProvider></MemoryRouter>,
  ))
}
function buttons() { return [...host.querySelectorAll<HTMLButtonElement>('button')] }
function button(label: string) { return buttons().find(b => b.textContent?.trim() === label)! }
function partyButton() { return host.querySelector<HTMLButtonElement>('[data-entry-field="party"] button')! }
// FinderModal 经 AppDialog 渲染，可能 portal 到 document.body —— 一律在 document 上查找
function finderOpen() { return document.querySelector('input[placeholder="搜索客户名称、编码…"]') != null }
function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

test('占库改单：点客户按钮不打开选择器、不发起异客户取价', async () => {
  render()
  await act(async () => { button('修改订单').click() })
  expect(host.textContent).toContain('改单中')      // 已进入改单视图（EditModeBadge）

  const party = partyButton()
  expect(party).toBeTruthy()
  await act(async () => { party.click() })

  expect(finderOpen()).toBe(false)                 // 旧实现：会打开 ⇒ 失败
  expect(mocks.getCustomerPriceApi).not.toHaveBeenCalled()
  expect(partyButton().disabled).toBe(true)
})

test('占库改单：改明细仍能提交，且载荷归属原客户', async () => {
  render()
  await act(async () => { button('修改订单').click() })

  const qty = host.querySelector<HTMLInputElement>('input[placeholder="数量"]')!
  expect(qty.value).toBe('5')
  await act(async () => { setInput(qty, '4') })
  expect(qty.value).toBe('4')

  await act(async () => { button('提交改单').click() })

  expect(mocks.adjustSaleApi).toHaveBeenCalledTimes(1)
  const payload = mocks.adjustSaleApi.mock.calls[0][0] as { customerId: number; items: Array<{ quantity: number }> }
  expect(payload.customerId).toBe(1)               // 归属原客户，未随界面变化
  expect(payload.items[0].quantity).toBe(4)
})

test('草稿编辑（正向对照）：客户按钮仍可打开选择器', async () => {
  client.setQueryData(['sale', 12], makeOrder(1))
  render()
  await act(async () => { button('编辑').click() })

  const party = partyButton()
  expect(party.disabled).toBe(false)
  await act(async () => { party.click() })
  await act(async () => {})
  expect(finderOpen()).toBe(true)
})
