// @vitest-environment jsdom
/**
 * 转采购单的请求键稳定性回归（2026-09-29）。
 *
 * 背景：`convertRequisitionApi` 曾**每次调用**都 `createRequestKey()`。转单失败后弹窗保留，
 * 用户再点「生成采购单」就用新键 —— 若上一次其实已在服务端成功（只是响应没回来），
 * 后端会把新键当新请求，**同一次转单意图被执行两遍**（真实后端复现：同键重放返回原回执；
 * 换成新键的同一意图 ⇒ 又建一张采购单、`converted_qty` 5→10 —— 总量仍在请购量内，
 * 所以**不是超量**问题，而是「同一意图重复执行」）。
 *
 * 注意：弹窗内容经 Radix Portal 挂在 `document.body`，因此**弹窗内的按钮/输入一律在
 * `document.querySelector('[role="dialog"]')` 范围内查找**；页面上（非弹窗）的按钮在 host 查。
 * 场景统一使用**部分转单（可转 10、本次转 5）**，以便覆盖「关窗重开后弹窗被重置为默认 10」
 * 这一真实行为。键断言要求**非空字符串**，不能靠两个 `undefined` 相等冒充稳定。
 *
 * 覆盖：① 不确定失败后原样重试 ⇒ 同键；② 不确定失败后改内容 ⇒ 被阻止；
 * ③ 关窗重开（内容被重置为默认 10）后直接提交 ⇒ **被阻止**（载荷已变）；
 * ④ 关窗重开后填回同一份内容（转 5）⇒ 仍是原键；⑤ 查回执 success ⇒ 换键，新一次转单用新键；
 * ⑥ 查回执 not_found ⇒ 不换键；⑦ 成功后新转单 ⇒ 换新键；⑧ 明确 4xx ⇒ 换新键。
 * 变异验证（人工）：把 `convertRequisitionApi` 改回「每次内部新建键」⇒ ①③④⑥ 必红。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import RequisitionFormPage from './form'

const mocks = vi.hoisted(() => ({
  getRequisitionApi: vi.fn(),
  convertRequisitionApi: vi.fn(),
  getOperationRequestStatusApi: vi.fn(),
}))

vi.mock('@/api/purchase-requisitions', () => ({
  listRequisitionsApi: vi.fn(), getRequisitionApi: mocks.getRequisitionApi,
  createRequisitionApi: vi.fn(), updateRequisitionApi: vi.fn(), submitRequisitionApi: vi.fn(),
  withdrawRequisitionApi: vi.fn(), cancelRequisitionApi: vi.fn(), approveRequisitionApi: vi.fn(),
  rejectRequisitionApi: vi.fn(), convertRequisitionApi: mocks.convertRequisitionApi,
}))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: mocks.getOperationRequestStatusApi }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true, permissions: [] }) }))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: vi.fn() }))
vi.mock('@/api/warehouses', () => ({
  getWarehousesActiveApi: vi.fn().mockResolvedValue([{ id: 1, name: '示例仓库' }]),
  getWarehousesApi: vi.fn(), createWarehouseApi: vi.fn(), updateWarehouseApi: vi.fn(), deleteWarehouseApi: vi.fn(),
}))
vi.mock('@/api/customers', () => ({
  getCustomersApi: vi.fn().mockResolvedValue({ list: [], total: 0 }), createCustomerApi: vi.fn(),
  updateCustomerApi: vi.fn(), deleteCustomerApi: vi.fn(),
}))
vi.mock('@/api/products', () => ({
  getProductsForFinderApi: vi.fn().mockResolvedValue({ list: [], total: 0 }), getProductQtyPoliciesApi: vi.fn().mockResolvedValue([]),
  getProductApi: vi.fn(), getProductsApi: vi.fn(), createProductApi: vi.fn(), updateProductApi: vi.fn(),
  deleteProductApi: vi.fn(), printProductLabelApi: vi.fn(),
}))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children?: unknown }) => <>{children}</> }))

let host: HTMLDivElement, root: Root, client: QueryClient

const detail = {
  id: 1, requisitionNo: 'PR-TEST-1', status: 3, statusName: '已批准', statusTone: 'active',
  title: '回归用', warehouseId: 1, warehouseName: '示例仓库', expectedDate: null, applicantName: '甲',
  approval: null, rejectReason: null, createdAt: '2026-09-29', remark: null,
  items: [{
    id: 11, productId: 9, productCode: 'P9', productName: '商品9', unit: '个',
    quantity: 10, convertedQty: 0, estimatedPrice: 10, suggestedSupplierId: 1, suggestedSupplierName: '供应商1',
  }],
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.getRequisitionApi.mockResolvedValue(detail)
  mocks.convertRequisitionApi.mockResolvedValue({ requisitionId: 1, createdOrders: [{ id: 1, orderNo: 'PC1', supplierName: '供应商1', itemCount: 1 }], completed: false })
  mocks.getOperationRequestStatusApi.mockResolvedValue({ status: 'not_found', data: null, message: '' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['requisition', 1], detail)     // 预置详情：避免依赖异步查询落定
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })

function render() {
  act(() => root.render(
    <MemoryRouter><QueryClientProvider client={client}>
      <TabPathContext.Provider value="/purchase-requisitions/1"><RequisitionFormPage /></TabPathContext.Provider>
    </QueryClientProvider></MemoryRouter>,
  ))
}
/** 弹窗内容经 Portal 挂到 body，必须在 document 的 dialog 内查找 */
function dlg() { return document.querySelector<HTMLElement>('[role="dialog"]') }
function pageButton(label: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)! }
function dlgButton(label: string) { return [...(dlg()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(b => b.textContent?.trim() === label)! }
async function openDialog() { await act(async () => { pageButton('转采购单').click() }) }
async function submit() { await act(async () => { dlgButton('生成采购单').click() }) }
async function closeDialog() { await act(async () => { dlgButton('取消').click() }) }
async function checkLast() { await act(async () => { dlgButton('查询上次结果').click() }) }
async function fillQty(v: string) {
  const input = dlg()!.querySelector<HTMLInputElement>('input[type="number"]')!
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
function keys(): unknown[] { return mocks.convertRequisitionApi.mock.calls.map(c => c[2]) }
function uncertainError() { return Object.assign(new Error('断网'), { code: 'NETWORK_ERROR' }) }
function rejectedError() { return Object.assign(new Error('数量超过可转余量'), { code: 'BAD_REQUEST' }) }

test('① 部分转单（转5/可转10）不确定失败后原样重试 ⇒ 两次请求键相同且非空', async () => {
  mocks.convertRequisitionApi.mockRejectedValueOnce(uncertainError())
  render(); await openDialog(); await fillQty('5'); await submit()
  expect(keys()).toHaveLength(1)
  await submit()
  expect(keys()).toHaveLength(2)
  // 不能只 toBeTruthy：实现若漏传参数，mock 收到的是 undefined（或 'undefined' 字面量）也会"真"
  expect(typeof keys()[0]).toBe('string')
  expect((keys()[0] as string).length).toBeGreaterThan(0)
  expect(keys()[1]).toBe(keys()[0])
})

test('② 不确定失败后改动内容再提交 ⇒ 被阻止（不发请求）', async () => {
  mocks.convertRequisitionApi.mockRejectedValueOnce(uncertainError())
  render(); await openDialog(); await fillQty('5'); await submit()
  await fillQty('3')
  await submit()
  expect(keys()).toHaveLength(1)
})

test('③ 关窗重开（弹窗被重置为默认 10）后直接提交 ⇒ 被阻止（载荷已变）', async () => {
  mocks.convertRequisitionApi.mockRejectedValueOnce(uncertainError())
  render(); await openDialog(); await fillQty('5'); await submit()
  expect(keys()).toHaveLength(1)
  await closeDialog()
  await openDialog()                                   // 重开后默认回到可转余量 10
  await submit()
  expect(keys()).toHaveLength(1)                       // ★ 与上次内容不同 ⇒ 不发请求
})

test('④ 关窗重开后填回同一份内容（转5）⇒ 仍是原键', async () => {
  mocks.convertRequisitionApi.mockRejectedValueOnce(uncertainError())
  render(); await openDialog(); await fillQty('5'); await submit()
  expect(keys()).toHaveLength(1)
  await closeDialog()
  await openDialog()
  await fillQty('5')
  await submit()
  expect(keys()).toHaveLength(2)
  expect(keys()[1]).toBe(keys()[0])
})

test('⑤ 查回执得 success ⇒ 键轮换，随后一次新的部分转单用新键', async () => {
  mocks.convertRequisitionApi.mockRejectedValueOnce(uncertainError())
  mocks.getOperationRequestStatusApi.mockResolvedValue({ status: 'success', data: null, message: 'ok' })
  render(); await openDialog(); await fillQty('5'); await submit()
  expect(keys()).toHaveLength(1)
  await checkLast()                                    // 确认上次其实成功了（onDone 关窗）
  await openDialog(); await fillQty('5'); await submit()
  expect(keys()).toHaveLength(2)
  expect(keys()[1]).not.toBe(keys()[0])
})

test('⑥ 查回执得 not_found ⇒ 不换键，同内容重提仍是原键', async () => {
  mocks.convertRequisitionApi.mockRejectedValueOnce(uncertainError())
  mocks.getOperationRequestStatusApi.mockResolvedValue({ status: 'not_found', data: null, message: '' })
  render(); await openDialog(); await fillQty('5'); await submit()
  expect(keys()).toHaveLength(1)
  await checkLast()
  await submit()
  expect(keys()).toHaveLength(2)
  expect(keys()[1]).toBe(keys()[0])
})

test('⑦ 成功后再发起新转单 ⇒ 换新键', async () => {
  render(); await openDialog(); await fillQty('5'); await submit()
  await openDialog(); await fillQty('5'); await submit()
  expect(keys()).toHaveLength(2)
  expect(keys()[1]).not.toBe(keys()[0])
})

test('⑧ 明确 4xx 拒绝后重试 ⇒ 换新键', async () => {
  mocks.convertRequisitionApi.mockRejectedValueOnce(rejectedError())
  render(); await openDialog(); await fillQty('5'); await submit()
  await submit()
  expect(keys()).toHaveLength(2)
  expect(keys()[1]).not.toBe(keys()[0])
})

test('⑨ 查回执得 pending（仍在服务器处理）⇒ 不换键', async () => {
  mocks.convertRequisitionApi.mockRejectedValueOnce(uncertainError())
  mocks.getOperationRequestStatusApi.mockResolvedValue({ status: 'pending', data: null, message: '' })
  render(); await openDialog(); await fillQty('5'); await submit()
  expect(keys()).toHaveLength(1)
  await checkLast()                                    // pending：仍不确定 ⇒ 保留原键
  await submit()
  expect(keys()).toHaveLength(2)
  expect(keys()[1]).toBe(keys()[0])
})
