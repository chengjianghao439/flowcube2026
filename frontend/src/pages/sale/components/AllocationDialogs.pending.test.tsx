// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ReserveAllocationDialog from './ReserveAllocationDialog'
import ReleaseAllocationDialog from './ReleaseAllocationDialog'
import ShipSelectDialog from './ShipSelectDialog'
import type { ReservePreview, SaleOrder } from '@/types/sale'

const fixture = vi.hoisted(() => ({ reserve: vi.fn(), release: vi.fn(), ship: vi.fn(), preview: undefined as unknown }))
// 只隔离 API 与数量策略；保留真实 Mutation pending、Dialog、Input 及组件交互。
vi.mock('@/hooks/useSale', () => ({
  useSaleReservePreview: () => ({ data: fixture.preview, isLoading: false }),
  useReserveSale: () => useMutation({ mutationFn: fixture.reserve }),
  useReleaseSale: () => useMutation({ mutationFn: fixture.release }),
}))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: (props: { value: number; disabled?: boolean; onChange: (id: number, name: string) => void }) => <select aria-label="发货仓库" disabled={props.disabled} value={props.value} onChange={e => props.onChange(Number(e.target.value), '合成仓库')}><option value={1}>合成仓库</option><option value={2}>第二仓库</option></select> }))

const item = { id: 17, productId: 27, productCode: 'SYNTHETIC-P', productName: '合成商品', unit: '个', warehouseId: 1, warehouseName: '合成仓库', quantity: 2, reservedQty: 2, dispatchedQty: 0, unitPrice: 1, amount: 2 }
const order: SaleOrder = { id: 7, orderNo: 'SYNTHETIC-SALE', customerId: 3, customerName: '合成客户', warehouseId: 1, warehouseName: '合成仓库', status: 2, statusName: '已占库', totalAmount: 2, operatorId: 9, operatorName: '合成员工', createdAt: '', items: [item] }
const preview: ReservePreview = { orderId: 7, warehouseId: 1, warehouseName: '合成仓库', items: [{ ...item, itemId: 17, reservedQty: 0, remainToReserve: 2, currentWarehouseId: 1, currentWarehouseName: '合成仓库', warehouses: [{ warehouseId: 1, warehouseName: '合成仓库', available: 2 }] }] }
let root: Root, host: HTMLDivElement, qc: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fixture.reserve.mockReset(); fixture.release.mockReset(); fixture.ship.mockReset(); fixture.preview = preview
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); host.remove() })
async function mount(node: React.ReactNode) { await act(async () => root.render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)) }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!
const quantity = () => document.querySelector<HTMLInputElement>('input[type="number"]')!
async function type(value: string) { await act(async () => { const field = quantity(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) }) }
async function escape() { await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))) }
function ShipHost({ close }: { close: () => void }) {
  const [loading, setLoading] = useState(false)
  return <ShipSelectDialog open order={order} onClose={close} loading={loading} onConfirm={items => { setLoading(true); fixture.ship(items).then(() => setLoading(false), () => setLoading(false)) }} />
}
const samples = [
  { name: '占库', action: '确认占用（1 项）', pending: '占用中…', submit: () => fixture.reserve, render: (close: () => void) => <ReserveAllocationDialog open orderId={7} onClose={close} onShortage={vi.fn()} /> },
  { name: '释放', action: '释放选中 1 项', pending: '释放中…', submit: () => fixture.release, render: (close: () => void) => <ReleaseAllocationDialog open orderId={7} items={[item]} onClose={close} /> },
  { name: '出库', action: '确认发起出库', pending: '发起中…', submit: () => fixture.ship, render: (close: () => void) => <ShipHost close={close} /> },
]

test.each(samples)('$name 在同一帧重复点击只发一次，pending 禁止关闭和改载荷；失败仍保留输入', async sample => {
  let reject!: (e: Error) => void
  sample.submit().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
  const close = vi.fn(); await mount(sample.render(close)); await type('1.25')
  const confirm = button(sample.action)
  // 先于 React Query / 父组件渲染 pending 的两次实际点击。
  await act(async () => { confirm.click(); confirm.click() })
  expect(sample.submit()).toHaveBeenCalledTimes(1)
  const expectedPayload = sample.name === '出库' ? [{ id: 17, qty: 1.25 }] : { id: 7, items: [{ id: 17, warehouseId: 1, warehouseName: '合成仓库', qty: 1.25 }] }
  expect(sample.submit().mock.calls[0][0]).toEqual(expectedPayload)
  await vi.waitFor(() => expect(button(sample.pending)?.disabled).toBe(true))
  expect(quantity().disabled).toBe(true)
  expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(field => field.disabled)).toBe(true)
  expect(document.querySelector<HTMLSelectElement>('select')?.disabled ?? true).toBe(true)
  await escape(); await act(async () => { button('取消').click(); button('关闭').click() })
  expect(close).not.toHaveBeenCalled()
  expect(quantity().value).toBe('1.25')
  await act(async () => reject(new Error('本批模拟失败')))
  await vi.waitFor(() => expect(quantity().disabled).toBe(false))
  expect(quantity().value).toBe('1.25')
  // 失败释放本次交互锁，原输入能再次确认，不生成另一份数量载荷。
  await act(async () => button(sample.action).click())
  expect(sample.submit()).toHaveBeenCalledTimes(2)
  expect(sample.submit().mock.calls[1][0]).toEqual(expectedPayload)
  await act(async () => reject(new Error('本批再次模拟失败')))
  await vi.waitFor(() => expect(quantity().disabled).toBe(false))
  await act(async () => button('取消').click()); expect(close).toHaveBeenCalledOnce()
})

test.each(samples)('$name 数量无效提示与实际两位小数合同一致', async sample => {
  await mount(sample.render(vi.fn())); await type(sample.name === '占库' ? '3' : '0')
  expect(document.body.textContent).toMatch(/最多(?:保留)?\s*(?:两|2)\s*位小数/)
  expect(document.body.textContent).not.toMatch(/四位|4\s*位小数/)
})

test.each(samples)('$name 已进入 pending 后数量、选择与关闭入口均冻结', async sample => {
  sample.submit().mockImplementation(() => new Promise(() => {}))
  const close = vi.fn(); await mount(sample.render(close))
  await act(async () => button(sample.action).click())
  await vi.waitFor(() => expect(button(sample.pending)?.disabled).toBe(true))
  await escape(); await act(async () => { button('取消').click(); button('关闭').click() })
  expect(close).not.toHaveBeenCalled()
  expect(quantity().disabled).toBe(true)
  expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(field => field.disabled)).toBe(true)
})
