import { saleEditorTestPreview } from '../commercial/saleEditorTestFixture'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
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
// 普通新建的真实保存回归已迁移至 CommercialEditor.test.tsx；保留历史编辑/改单保存入口；API mock 承接请求，Hook 包装提供相同的界面解释草稿。


const draft: DraftItem = {
  _key: 9, productId: 9, productCode: 'P-9', productName: '示例商品', unit: '个', entryUnit: '箱',
  quantity: 2, unitPrice: 120.1234, remark: '', priceSource: 'list', resolvedPrice: 120.1234,
  resolvedPriceLevel: null, costPrice: 3, warehouseId: 1, warehouseName: '示例仓库',
  units: [{ unitName: '个', conversionRate: 1, isBase: true }, { unitName: '箱', conversionRate: 12, isBase: false }],
  priceExplanation: { kind: 'price_list', name: '专价' },
} as DraftItem
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
      unit: '个', entryUnit: '箱', entryQty: 2, conversionRate: 12, quantity: 24, unitPrice: 10.01028333, amount: 240.25,
      reservedQty: 5, dispatchedQty: 0, shippedQty: 0, warehouseId: 1, warehouseName: '示例仓库', remark: '',
    }],
  } as unknown as SaleOrder
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  previousAuth = useAuthStore.getState()
  useAuthStore.setState({ token: 'fixture', user: { id: 5, roleId: 5, permissions: [PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.PRODUCT_VIEW] } as never })
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
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); window.history.replaceState({}, '', '/'); useAuthStore.setState(previousAuth) })

function render(path = '/sale/12') {
  act(() => root.render(
    <MemoryRouter initialEntries={["/sale/12"]}><QueryClientProvider client={client}>
      <TabPathContext.Provider value={path}><SaleFormPage /></TabPathContext.Provider>
    </QueryClientProvider></MemoryRouter>,
  ))
}
async function settleEditor() {
  for (let step=0;step<3;step++) await act(async () => { await new Promise(resolve => setTimeout(resolve,5)) })
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
  ['edit', 1, '/sale/12', '编辑', '保存修改'],
  ['adjust', 2, '/sale/12', '修改订单', '提交改单'],
] as const)('%s 实际保存入口不发送解释字段且保留原业务字段', async (mode, status, path, entry, save) => {
  client.setQueryData(['sale', 12], makeOrder(status))
  render(path)
  if (entry) await act(async () => { button(entry).click(); await new Promise(resolve => setTimeout(resolve,15)) })
  await settleEditor()
  await act(async () => button(save).click())
  const api = mode === 'edit' ? mocks.updateSaleApi : mocks.adjustSaleApi
  expect(api).toHaveBeenCalledTimes(1)
  const payload = api.mock.calls[0][0]
  expect(payload.items[0]).toMatchObject({ productId:9, unit:'个', entryUnit:'箱', quantity:2, unitPrice:120.1234, priceSource:'manual', remark:'' })
  expect(payload.discountAmount).toBe(0)
  expect(payload.items[0].quantity * payload.items[0].unitPrice).toBe(240.2468)
})

test('本标签逆向交接和全局另单hash均不关闭已有编辑草稿', async () => {
  client.setQueryData(['sale', 12], makeOrder(1))
  render()
  await act(async () => { button('编辑').click(); await new Promise(resolve => setTimeout(resolve,15)) })
  await settleEditor()
  const remark = host.querySelector<HTMLTextAreaElement>('textarea')
  expect(remark).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(remark, '本次尚未保存的备注')
    remark!.dispatchEvent(new Event('input', { bubbles: true }))
    window.history.replaceState({}, '', '/#/sale/99?focus=progress&taskId=91')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  render('/sale/12?focus=progress&taskId=91')
  expect(button('保存修改')).toBeTruthy()
  expect(host.querySelector('textarea')!.value).toBe('本次尚未保存的备注')
  expect(mocks.updateSaleApi).not.toHaveBeenCalled()
  expect(mocks.adjustSaleApi).not.toHaveBeenCalled()
})

// 列表交接使用真实路由上下文，清掉一次性编辑意图后仍保留原编辑实例。
function DirectEditRoute() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-route>{location.pathname + location.search}</output>
    <button onClick={() => navigate('/sale/12?edit=1')}>再次从列表编辑</button>
    <TabPathContext.Provider value={location.pathname + location.search}><SaleFormPage /></TabPathContext.Provider></>
}
async function renderDirectEdit() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/sale/12?edit=1']}><QueryClientProvider client={client}><DirectEditRoute /></QueryClientProvider></MemoryRouter>)); await act(async () => { await new Promise(resolve => setTimeout(resolve,15)) })
}
test('列表编辑意图直接进入普通草稿编辑，取消后可再次进入且不保存', async () => {
  client.setQueryData(['sale', 12], makeOrder(1))
  await renderDirectEdit(); await settleEditor()
  expect(host.querySelector('[data-order-entry]')).not.toBeNull()
  expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/12')
  await act(async () => button('取消编辑').click())
  expect(host.querySelector('[data-order-entry]')).toBeNull()
  await act(async () => { button('再次从列表编辑').click(); await new Promise(resolve => setTimeout(resolve,15)) })
  await settleEditor()
  expect(host.querySelector('[data-order-entry]')).not.toBeNull()
  expect(mocks.updateSaleApi).not.toHaveBeenCalled()
})
test.each([2, 4])('普通订单状态%s的编辑意图不会绕过草稿编辑资格或进入改单', async status => {
  client.setQueryData(['sale', 12], makeOrder(status))
  await renderDirectEdit(); await settleEditor()
  expect(host.querySelector('[data-order-entry]')).toBeNull()
  expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/12')
})
test('无原编辑权限的普通草稿仍为详情', async () => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [PERMISSIONS.SALE_ORDER_VIEW] } })
  client.setQueryData(['sale', 12], makeOrder(1))
  await renderDirectEdit(); await settleEditor()
  expect(host.querySelector('[data-order-entry]')).toBeNull()
})
