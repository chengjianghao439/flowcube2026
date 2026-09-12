// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getCustomerPriceApi, type CustomerResolvedPrice } from '@/api/price-lists'
import { getProductApi } from '@/api/products'
import type { ProductFinderResult } from '@/types/products'
import { useSaleOrderForm } from './useSaleOrderForm'
import ProductFinder from '@/components/shared/ProductFinderModal'

vi.mock('@/hooks/useProducts', () => ({ useProductFinder: () => ({ data: { list: [product(10)], pagination: { total: 1 } }, isLoading: false, isFetching: false }) }))
vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: [] }) }))

vi.mock('@/api/price-lists', () => ({ getCustomerPriceApi: vi.fn() }))
vi.mock('@/api/products', () => ({ getProductApi: vi.fn() }))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: vi.fn() }))
vi.mock('@/hooks/useCarriers', () => ({ useCarriersActive: () => ({ data: [] }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const product = (id: number): ProductFinderResult => ({ id, code: `P${id}`, name: `商品${id}`, unit: '个', salePrice: 12 } as ProductFinderResult)
const price = (salePrice: number): CustomerResolvedPrice => ({ salePrice, priceLevel: 'A', priceLevelName: 'A' })
let root: Root, host: HTMLDivElement, form: ReturnType<typeof useSaleOrderForm>, unmounted: boolean
let requests: Array<ReturnType<typeof deferred<CustomerResolvedPrice | null>>>
function Harness() { form = useSaleOrderForm('/sale/new'); return null }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks(); requests = []; unmounted = false
  vi.mocked(getCustomerPriceApi).mockImplementation(() => {
    const request = deferred<CustomerResolvedPrice | null>(); requests.push(request); return request.promise
  })
  vi.mocked(getProductApi).mockResolvedValue(undefined as never)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<StrictMode><Harness /></StrictMode>))
})
afterEach(() => { if (!unmounted) act(() => root.unmount()); host.remove() })
function customer(id: number) { act(() => form.handleCustomerConfirm({ id, name: `客户${id}` })) }
async function selectProduct(id: number, key?: number) {
  act(() => { if (key === undefined) form.addItem(); else form.setFinderItemKey(key) })
  await act(async () => { void form.handleFinderConfirm(product(id)) })
  return form.items.at(-1)!._key
}
async function resolve(index: number, value: CustomerResolvedPrice | null) { await act(async () => requests[index].resolve(value)) }
async function reject(index: number) { await act(async () => requests[index].reject(new Error('离线'))) }

test('快速切换客户：较旧响应不能覆盖当前客户价格', async () => {
  customer(1); await selectProduct(10); customer(2)
  await resolve(requests.length - 1, price(22)); await resolve(0, price(11))
  expect(form.customerId).toBe('2'); expect(form.items[0].unitPrice).toBe(22)
})
test('快速切换商品：旧响应不能覆盖新商品或提前结束 loading', async () => {
  customer(1); const key = await selectProduct(10); await selectProduct(20, key)
  await resolve(0, price(11))
  expect(form.items[0].productId).toBe(20); expect(form.items[0].unitPrice).toBe(12)
  expect(form.priceLoading[key]).toBe(true)
  await resolve(1, price(22)); expect(form.items[0].unitPrice).toBe(22); expect(form.priceLoading[key]).toBe(false)
})
test('请求途中手动定价优先，迟到响应不能覆盖手工价', async () => {
  customer(1); const key = await selectProduct(10)
  act(() => form.updateItem(key, 'unitPrice', 33))
  await resolve(0, price(11)); expect(form.items[0].unitPrice).toBe(33); expect(form.items[0].priceSource).toBe('manual')
  expect(form.priceLoading[key]).toBe(false)
})
test('明确再次切换客户仍会对已有手工价重新定价', async () => {
  customer(1); const key = await selectProduct(10); act(() => form.updateItem(key, 'unitPrice', 33)); customer(2)
  await resolve(requests.length - 1, price(22)); expect(form.items[0].unitPrice).toBe(22)
})
test('旧客户请求结束不会清除新客户请求的 loading', async () => {
  customer(1); const key = await selectProduct(10); customer(2)
  await resolve(0, price(11)); expect(form.priceLoading[key]).toBe(true)
  await resolve(requests.length - 1, price(22)); expect(form.priceLoading[key]).toBe(false)
})
test('删除行使全部回调失效并清理 loading', async () => {
  customer(1); const key = await selectProduct(10); act(() => form.removeItem(key))
  await resolve(0, price(11)); expect(form.items).toEqual([]); expect(form.priceLoading).not.toHaveProperty(String(key))
})
test('卸载后未完成请求不能改变 hook 回执', async () => {
  customer(1); await selectProduct(10)
  const before = form.items
  act(() => root.unmount()); unmounted = true
  await resolve(0, price(99)); expect(form.items).toBe(before)
})
test('切换客户查价失败必须提示确认，手动输入相同数值也可确认', async () => {
  customer(1); const key = await selectProduct(10); await resolve(0, price(11)); customer(2)
  await reject(requests.length - 1)
  expect(form.priceErrors[key]).toContain('请手动确认单价')
  expect(form.items[0].resolvedPrice).toBeNull()
  act(() => form.updateItem(key, 'unitPrice', 11)); expect(form.priceErrors[key]).toBeUndefined()
})
test('当前客户未配置商品价格不静默继承另一客户价格', async () => {
  customer(1); const key = await selectProduct(10); await resolve(0, price(11)); customer(2)
  await resolve(requests.length - 1, null)
  expect(form.priceErrors[key]).toContain('请手动确认单价'); expect(form.items[0].resolvedPrice).toBeNull()
})
test('过期失败不能给当前已成功价格添加错误', async () => {
  customer(1); const key = await selectProduct(10); customer(2)
  await resolve(requests.length - 1, price(22)); await reject(0)
  expect(form.items[0].unitPrice).toBe(22); expect(form.priceErrors[key]).toBeUndefined()
})
test('StrictMode 不会重复发起客户重定价请求', async () => {
  await selectProduct(10); customer(1)
  expect(getCustomerPriceApi).toHaveBeenCalledTimes(1)
  await resolve(0, price(11))
})

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('无效响应价格 %s 必须留待手动确认', async (value) => {
  customer(1); const key = await selectProduct(10); await resolve(0, price(value))
  expect(form.priceErrors[key]).toContain('请手动确认单价'); expect(form.items[0].unitPrice).toBe(12)
})
test('同一事件批次切换客户后选择商品仍查询新客户', async () => {
  customer(1); const key = await selectProduct(10)
  await act(async () => { form.handleCustomerConfirm({ id: 2, name: '客户2' }); void form.handleFinderConfirm(product(20)) })
  expect(getCustomerPriceApi).toHaveBeenLastCalledWith(2, 20)
  await resolve(2, price(22)); await resolve(1, price(11)); await resolve(0, price(10))
  expect(form.items[0].unitPrice).toBe(22); expect(form.priceLoading[key]).toBe(false)
})
test('切回同一商品仍忽略第一次选品的旧单位响应', async () => {
  const units = [deferred<Awaited<ReturnType<typeof getProductApi>>>(), deferred<Awaited<ReturnType<typeof getProductApi>>>(), deferred<Awaited<ReturnType<typeof getProductApi>>>()]
  units.forEach(d => vi.mocked(getProductApi).mockImplementationOnce(() => d.promise))
  const key = await selectProduct(10); await selectProduct(20, key); await selectProduct(10, key)
  await act(async () => units[2].resolve({ units: [{ unitName: '箱', conversionRate: 12 }] } as Awaited<ReturnType<typeof getProductApi>>))
  await act(async () => units[0].resolve({ units: [{ unitName: '旧箱', conversionRate: 6 }] } as Awaited<ReturnType<typeof getProductApi>>))
  expect(form.items[0].units?.[0].unitName).toBe('箱')
})
test('卸载会取消待执行的选品聚焦', async () => {
  vi.useFakeTimers()
  try {
    const key = await selectProduct(10)
    const input = document.createElement('input'); const focus = vi.spyOn(input, 'focus'); form.quantityRefs.current.set(key, input)
    act(() => root.unmount()); unmounted = true
    act(() => vi.runOnlyPendingTimers())
    expect(focus).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

test('编辑初始单位加载不能覆盖重新选品后的单位', async () => {
  const initialUnits = deferred<Awaited<ReturnType<typeof getProductApi>>>()
  vi.mocked(getProductApi).mockImplementation(() => initialUnits.promise)
  const order = {
      customerId: 1, warehouseId: 1,
      items: [{ productId: 10, productCode: 'P10', productName: '商品10', unit: '个', quantity: 1, unitPrice: 12, amount: 12 }],
    } as NonNullable<Parameters<typeof useSaleOrderForm>[1]>
  function EditHarness() {
    form = useSaleOrderForm('/sale/1', order)
    return null
  }
  act(() => root.render(<StrictMode><EditHarness /></StrictMode>))
  vi.mocked(getProductApi).mockResolvedValue({ units: [{ unitName: '新箱', conversionRate: 12 }] } as Awaited<ReturnType<typeof getProductApi>>)
  await selectProduct(10, form.items[0]._key)
  expect(form.items[0].units?.[0].unitName).toBe('新箱')
  await act(async () => initialUnits.resolve({ units: [{ unitName: '旧箱', conversionRate: 6 }] } as Awaited<ReturnType<typeof getProductApi>>))
  expect(form.items[0].units?.[0].unitName).toBe('新箱')
})


test('空白新建通过真实 ProductFinder 单击后确认，关闭弹窗仍回填选中行', async () => {
  function FinderHarness() {
    form = useSaleOrderForm('/sale/new')
    return <><button onClick={form.addItem}>添加商品</button>
      {form.items.map(item => <input key={item._key} data-quantity={item._key} value={item.quantity} readOnly ref={el => { if (el) form.quantityRefs.current.set(item._key, el) }} />)}
      <ProductFinder open={form.finderOpen} mode="sale" onConfirm={form.handleFinderConfirm}
        onClose={() => { form.setFinderOpen(false); form.setFinderItemKey(null) }} />
    </>
  }
  await act(async () => root.render(<StrictMode><FinderHarness /></StrictMode>))
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  const row = document.querySelector<HTMLTableRowElement>('[role="dialog"] tbody tr')!
  expect(row.textContent).toContain('商品10')
  await act(async () => row.click())
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '确认选择')!
  expect(confirm.disabled).toBe(false)
  await act(async () => confirm.click())
  expect(form.finderOpen).toBe(false)
  expect(form.finderItemKey).toBeNull()
  expect(form.items[0]).toMatchObject({ productId: 10, quantity: 0, unitPrice: 12 })
})
