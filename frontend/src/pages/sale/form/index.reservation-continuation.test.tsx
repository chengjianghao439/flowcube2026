import { saleEditorTestPreview } from '../commercial/saleEditorTestFixture'
// @vitest-environment jsdom

import { act } from 'react'
import { webcrypto } from 'node:crypto'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { SaleOrder } from '@/types/sale'
import SaleFormPage from './index'

const mocks = vi.hoisted(() => ({
  adjustSaleApi: vi.fn(),
  updateSaleApi: vi.fn(),
  getCustomerPriceApi: vi.fn(),
  getCustomersApi: vi.fn(),
  getProductApi: vi.fn(),
  getSaleDetailApi: vi.fn(), getSaleReservePreviewApi: vi.fn(), reserveSaleApi: vi.fn(),
}))

vi.mock('@/api/sale', () => ({
  getSaleListApi: vi.fn(), getSaleDetailApi: mocks.getSaleDetailApi, getSaleReservePreviewApi: mocks.getSaleReservePreviewApi,
  createSaleApi: vi.fn(), updateSaleApi: mocks.updateSaleApi, adjustSaleApi: mocks.adjustSaleApi,
  reserveSaleApi: mocks.reserveSaleApi, releaseSaleApi: vi.fn(), shipSaleApi: vi.fn(), cancelSaleApi: vi.fn(), deleteSaleApi: vi.fn(),
}))
vi.mock('@/api/sale-commercial', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/sale-commercial')>()
  return { ...actual, getCommercialSaleApi: async () => client.getQueryData(['sale',12]),
    previewCommercialSaleApi: async (body: Parameters<typeof saleEditorTestPreview>[0]) => saleEditorTestPreview(body),
    executeCommercialSaleApi: async (plan: Parameters<typeof actual.executeCommercialSaleApi>[0]) => {
      if (plan.operation.action === 'adjust') return mocks.adjustSaleApi({ ...plan.operation.body, id: plan.operation.id })
      return mocks.updateSaleApi({ ...plan.operation.body, id: plan.operation.id })
    }
  }
})
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
let previousAuth: ReturnType<typeof useAuthStore.getState>

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
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto})
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,fn:()=>unknown)=>fn()}})
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  previousAuth = useAuthStore.getState()
  useAuthStore.setState({ token: 'fixture', user: { id: 5, roleId: 5, permissions: [PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.SALE_ORDER_RESERVE, PERMISSIONS.SALE_ORDER_SHIP, PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.PRODUCT_VIEW] } as never })
  mocks.adjustSaleApi.mockResolvedValue({ adjustmentId: null, adjustmentNo: null, pending: false })
  mocks.updateSaleApi.mockResolvedValue(null)
  mocks.getCustomerPriceApi.mockResolvedValue({ salePrice: 10, priceLevel: 'A' })
  mocks.getCustomersApi.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 500 })
  mocks.getProductApi.mockResolvedValue({ units: [] })
  window.history.replaceState({}, '', '/#/sale/12')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['sale', 12], continuationOrder())
  mocks.getSaleDetailApi.mockResolvedValue(continuationOrder())
  mocks.getSaleReservePreviewApi.mockResolvedValue(preview)
  mocks.reserveSaleApi.mockResolvedValue(null)
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); window.history.replaceState({}, '', '/'); useAuthStore.setState(previousAuth) })

function render() {
  act(() => root.render(
    <MemoryRouter initialEntries={["/sale/12"]}><QueryClientProvider client={client}>
      <TabPathContext.Provider value="/sale/12"><SaleFormPage /></TabPathContext.Provider>
    </QueryClientProvider></MemoryRouter>,
  ))
}
async function settleEditor() {
  for (let step=0;step<3;step++) await act(async () => { await new Promise(resolve => setTimeout(resolve,5)) })
}
function buttons() { return [...host.querySelectorAll<HTMLButtonElement>('button')] }
function button(label: string) { return buttons().find(b => b.textContent?.trim() === label)! }


function continuationOrder(patch: Partial<SaleOrder> = {}): SaleOrder {
  const base = makeOrder(3)
  return { ...base, totalAmount: 1000, shippedTotalQty: 4, orderedTotalQty: 10, hasUndispatchedItems: false, hasUnreservedItems: true,
    items: [{ ...base.items![0], quantity: 10, reservedQty: 4, dispatchedQty: 4, shippedQty: 4 }], ...patch }
}
const preview = { orderId: 12, warehouseId: 1, warehouseName: '示例仓库', items: [{ itemId: 9, productId: 9, productName: '示例商品', productCode: 'P-9', unit: '个', allowDecimalQty: false, quantity: 10, reservedQty: 4, remainToReserve: 6, currentWarehouseId: 1, currentWarehouseName: '示例仓库', warehouses: [{ warehouseId: 1, warehouseName: '示例仓库', available: 6, quantity: 6, expected: 0, reserved: 0, pickableQuantity: 6 }] }] }
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]')
const dialogButton = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)!

test('真实普通详情的部分实发4保留原需求10，补占弹窗只提交原单剩余6', async () => {
  render()
  expect(button('补占库存')).toBeTruthy()
  expect(button('继续发货')).toBeUndefined()
  await act(async () => button('补占库存').click()); await settleEditor()
  expect(dialog()).not.toBeNull()
  const quantity = dialog()!.querySelector<HTMLInputElement>('input[aria-label="示例商品本次占库数量"]')!
  expect(quantity.value).toBe('6')
  expect(quantity.step).toBe('1')
  expect(dialog()!.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true)
  await act(async () => dialogButton('确认占用（1 项）').click()); await settleEditor()
  expect(mocks.reserveSaleApi).toHaveBeenCalledOnce()
  expect(mocks.reserveSaleApi.mock.calls[0].slice(0, 2)).toEqual([12, [{ id: 9, warehouseId: 1, warehouseName: '示例仓库', qty: 6 }]])
  expect(mocks.reserveSaleApi.mock.calls[0][2]).toMatch(/^sale-reserve-/)
})

test('关闭并重开补占保持未写事实，原需求不被弹窗打开或返回改写', async () => {
  render()
  for (let i = 0; i < 2; i++) {
    await act(async () => button('补占库存').click()); await settleEditor()
    expect(dialog()!.querySelector<HTMLInputElement>('input[aria-label="示例商品本次占库数量"]')!.value).toBe('6')
    await act(async () => dialogButton('取消').click()); await settleEditor()
    expect(dialog()).toBeNull()
  }
  expect(mocks.reserveSaleApi).not.toHaveBeenCalled()
  expect((client.getQueryData(['sale', 12]) as SaleOrder).items![0].quantity).toBe(10)
})

test.each([4, 5] as const)('终态%s详情无补占入口，不重开原需求', status => {
  client.setQueryData(['sale', 12], continuationOrder({ status }))
  render()
  expect(button('补占库存')).toBeUndefined()
  expect(mocks.reserveSaleApi).not.toHaveBeenCalled()
})

test('全部累计已占时隐藏补占，仍保留已占未派的继续发货', () => {
  client.setQueryData(['sale', 12], continuationOrder({ hasUnreservedItems: false, hasUndispatchedItems: true }))
  render()
  expect(button('补占库存')).toBeUndefined()
  expect(button('继续发货')).toBeTruthy()
})

test('其他旧任务待取消/改单确认时补占按钮禁用，正常活动任务不禁用', async () => {
  client.setQueryData(['sale', 12], continuationOrder({ tasks: [{ taskId: 99, taskNo: '原任务', status: 2, statusName: '拣货中', warehouseId: 1, warehouseName: '示例仓库', adjustmentRequestedAt: '2026-10-13' }] }))
  render()
  expect(button('补占库存').disabled).toBe(true)
  await act(async () => { client.setQueryData(['sale', 12], continuationOrder({ tasks: [{ taskId: 99, taskNo: '原任务', status: 2, statusName: '拣货中', warehouseId: 1, warehouseName: '示例仓库' }] })); await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(button('补占库存').disabled).toBe(false)
})

test('无占库权限的真实详情不提供续补入口', () => {
  useAuthStore.setState({ user: { id: 5, roleId: 5, permissions: [PERMISSIONS.SALE_ORDER_VIEW] } as never })
  render()
  expect(button('补占库存')).toBeUndefined()
})
