// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { SaleOrder } from '@/types/sale'
import SaleFormPage from './index'
import { saleEditorTestPreview } from '../commercial/saleEditorTestFixture'

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
vi.mock('@/api/sale-commercial', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/sale-commercial')>()
  return { ...actual, getCommercialSaleApi: async () => client.getQueryData(['sale', 12]),
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
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  previousAuth = useAuthStore.getState()
  useAuthStore.setState({ token: 'fixture', user: { id: 5, roleId: 5, permissions: [PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.PRODUCT_VIEW] } as never })
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
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); window.history.replaceState({}, '', '/'); useAuthStore.setState(previousAuth) })

function render() {
  act(() => root.render(
    <MemoryRouter initialEntries={['/sale/12']}><QueryClientProvider client={client}>
      <TabPathContext.Provider value="/sale/12"><SaleFormPage /></TabPathContext.Provider>
    </QueryClientProvider></MemoryRouter>,
  ))
}
async function settleEditor() {
  for (let step = 0; step < 3; step++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
}
function buttons() { return [...host.querySelectorAll<HTMLButtonElement>('button')] }
function button(label: string) { return buttons().find(b => b.textContent?.trim() === label)! }
function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}



test.each([['edit', 1, '编辑', '保存修改'], ['adjust', 2, '修改订单', '提交改单']] as const)('%s错误就地显示、纠正即消失，失败保存只聚焦本视图且不调用写接口', async (_mode, status, entry, save) => {
  client.setQueryData(['sale', 12], makeOrder(status))
  const otherDraft = document.createElement('div')
  otherDraft.hidden = true
  otherDraft.innerHTML = '<input data-entry-field="item-0-quantity" aria-label="另一草稿数量" />'
  document.body.prepend(otherDraft)
  try {
    render()
    await act(async () => button(entry).click())
    await settleEditor()
    const qty = host.querySelector<HTMLInputElement>('input[aria-label="示例商品数量"]')!
    await act(async () => setInput(qty, '0'))
    await act(async () => button(save).click())
    expect(qty.closest('td')!.textContent).toContain('数量须大于零')
    expect([...host.querySelectorAll('[role="alert"]')].filter(node => node.textContent?.includes('数量须大于零'))).toHaveLength(1)
    expect(host.textContent).not.toContain('处需要处理')
    expect(document.activeElement).toBe(qty)
    expect(mocks.updateSaleApi).not.toHaveBeenCalled()
    expect(mocks.adjustSaleApi).not.toHaveBeenCalled()
    await act(async () => setInput(qty, '4'))
    expect(host.textContent).not.toContain('数量须大于零')
    const price = host.querySelector<HTMLInputElement>('input[aria-label="示例商品成交单价"]')!
    await act(async () => setInput(price, '0'))
    expect(price.closest('td')!.textContent).toContain('成交价须大于零')
    expect(host.textContent).not.toContain('处需要处理')
    expect(mocks.updateSaleApi).not.toHaveBeenCalled()
    expect(mocks.adjustSaleApi).not.toHaveBeenCalled()
  } finally { otherDraft.remove() }
})

test('普通编辑电话与折扣错误留在对应字段，纠正后不清草稿或发请求', async () => {
  client.setQueryData(['sale', 12], makeOrder(1))
  render()
  await act(async () => button('编辑').click())
  await settleEditor()
  const phone = host.querySelector<HTMLInputElement>('[data-entry-field="phone"]')!
  const discount = host.querySelector<HTMLInputElement>('[data-entry-field="discount"] input')!
  await act(async () => setInput(discount, '600'))
  await settleEditor()
  expect(discount.closest('div[data-entry-field="discount"]')!.textContent).toContain('折扣金额不能超过商品金额')
  await act(async () => setInput(phone, '12'))
  await act(async () => button('保存修改').click())
  expect(phone.parentElement!.parentElement!.textContent).toContain('联系电话格式不正确')
  expect(host.textContent).not.toContain('处需要处理')
  expect(mocks.updateSaleApi).not.toHaveBeenCalled()
  await act(async () => { setInput(phone, '13900000001'); setInput(discount, '10') })
  expect(host.textContent).not.toContain('联系电话格式不正确')
  await settleEditor()
  expect(host.textContent).not.toContain('折扣金额不能超过商品金额')
  expect(phone.value).toBe('13900000001')
  expect(discount.value).toBe('10')
  expect(mocks.updateSaleApi).not.toHaveBeenCalled()
})
