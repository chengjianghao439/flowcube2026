// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import type { SaleOrder } from '@/types/sale'
import SaleFormPage from './index'
import { serializeSaleItems } from './validate'
import type { DraftItem } from './validate'

const mocks = vi.hoisted(() => ({
  getSaleDetailApi: vi.fn(),
  createSaleApi: vi.fn(),
  adjustSaleApi: vi.fn(),
  updateSaleApi: vi.fn(),
  getCustomerPriceApi: vi.fn(),
  getCustomersApi: vi.fn(),
  getProductApi: vi.fn(),
}))

vi.mock('@/api/sale', () => ({
  getSaleListApi: vi.fn(), getSaleDetailApi: mocks.getSaleDetailApi, getSaleReservePreviewApi: vi.fn(),
  createSaleApi: mocks.createSaleApi, updateSaleApi: mocks.updateSaleApi, adjustSaleApi: mocks.adjustSaleApi,
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
// 保持三个真实保存入口；API mock 承接请求，Hook 包装提供相同的界面解释草稿。


const draft: DraftItem = {
  _key: 9, productId: 9, productCode: 'P-9', productName: '示例商品', unit: '个', entryUnit: '箱',
  quantity: 2, unitPrice: 120.1234, remark: '', priceSource: 'list', resolvedPrice: 120.1234,
  resolvedPriceLevel: null, costPrice: 3, warehouseId: 1, warehouseName: '示例仓库',
  units: [{ unitName: '个', conversionRate: 1, isBase: true }, { unitName: '箱', conversionRate: 12, isBase: false }],
  priceExplanation: { kind: 'price_list', name: '专价' },
} as DraftItem
vi.mock('./useSaleOrderForm', async importOriginal => {
  const actual = await importOriginal<typeof import('./useSaleOrderForm')>()
  return { ...actual, useSaleOrderForm: (...args: Parameters<typeof actual.useSaleOrderForm>) => ({
    ...actual.useSaleOrderForm(...args), customerId: '1', customerName: '示例客户', warehouseId: '1', warehouseName: '示例仓库',
    items: [draft], total: 240.2468, discountedTotal: 240.2468,
  }) }
})

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
  mocks.createSaleApi.mockResolvedValue({ id: 12 })
  mocks.getCustomerPriceApi.mockResolvedValue({ salePrice: 10, priceLevel: 'A' })
  mocks.getCustomersApi.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 500 })
  mocks.getProductApi.mockResolvedValue({ units: [] })
  window.history.replaceState({}, '', '/#/sale/12')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['sale', 12], makeOrder(2))
  mocks.getSaleDetailApi.mockImplementation(async () => client.getQueryData(['sale', 12]))
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); window.history.replaceState({}, '', '/') })

function render(path = '/sale/12') {
  act(() => root.render(
    <MemoryRouter><QueryClientProvider client={client}>
      <TabPathContext.Provider value={path}><SaleFormPage /></TabPathContext.Provider>
    </QueryClientProvider></MemoryRouter>,
  ))
}
function buttons() { return [...host.querySelectorAll<HTMLButtonElement>('button')] }
function button(label: string) { return buttons().find(b => b.textContent?.trim() === label)! }

const originalBusinessFields = {
  productId: 9, productCode: 'P-9', productName: '示例商品', unit: '个', entryUnit: '箱',
  quantity: 2, unitPrice: 120.1234, remark: '', priceSource: 'list', resolvedPrice: 120.1234,
  resolvedPriceLevel: null, costPrice: 3, warehouseId: 1, warehouseName: '示例仓库',
}

test('共享销售序列化只剥界面字段，完整保留业务数量、价格与凭据', () => {
  expect(serializeSaleItems([draft])).toEqual([originalBusinessFields])
  expect(draft).toHaveProperty('priceExplanation')
  expect(draft.units).toHaveLength(2)
})

test.each([
  ['create', 1, '/sale/new', null, '保存草稿'],
  ['edit', 1, '/sale/12', '编辑', '保存修改'],
  ['adjust', 2, '/sale/12', '修改订单', '提交改单'],
] as const)('%s 实际保存入口不发送解释字段且保留原业务字段', async (mode, status, path, entry, save) => {
  client.setQueryData(['sale', 12], makeOrder(status))
  render(path)
  if (entry) await act(async () => button(entry).click())
  await act(async () => button(save).click())
  const api = mode === 'create' ? mocks.createSaleApi : mode === 'edit' ? mocks.updateSaleApi : mocks.adjustSaleApi
  expect(api).toHaveBeenCalledTimes(1)
  const payload = api.mock.calls[0][0]
  expect(payload.items).toEqual([originalBusinessFields])
  expect(payload.discountAmount).toBe(0)
  expect(payload.items[0].quantity * payload.items[0].unitPrice).toBe(240.2468)
})
