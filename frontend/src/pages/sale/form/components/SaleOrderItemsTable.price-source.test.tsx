// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DraftItem } from '../validate'
import { SaleOrderItemsTable } from './SaleOrderItemsTable'
import { useSaleOrderForm } from '../useSaleOrderForm'
import { getProductApi } from '@/api/products'

vi.mock('@/api/products', () => ({ getProductApi: vi.fn() }))
vi.mock('@/api/price-lists', () => ({ getCustomerPriceApi: vi.fn() }))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: vi.fn() }))
vi.mock('@/hooks/useCarriers', () => ({ useCarriersActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
let root: Root, host: HTMLDivElement
const updateItem = vi.fn()
const item = { _key: 1, productId: 10, productCode: 'P10', productName: '铰链', articleNumber: 'H10', spec: '直臂', color: '银色', unit: '个', entryUnit: '箱', quantity: 2, unitPrice: 120,
  units: [{ unitName: '个', conversionRate: 1, isBase: true }, { unitName: '箱', conversionRate: 12, isBase: false }], priceSource: 'list',
} as DraftItem
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  updateItem.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
function render(row: DraftItem) {
  act(() => root.render(<MemoryRouter><SaleOrderItemsTable items={[row]} invalidItemKeys={new Set()} quantityRefs={{ current: new Map() }} priceLoading={{}} setFinderItemKey={vi.fn()} setFinderOpen={vi.fn()} updateItem={updateItem} removeItem={vi.fn()} /></MemoryRouter>))
}

test.each([
  [{ kind: 'price_list', name: '门店专价' }, '客户价格表：门店专价'],
  [{ kind: 'price_level', name: '价格B', level: 'B' }, '客户等级价：价格B'],
  [{ kind: 'price_level', name: '', level: 'C' }, '客户等级价：C'],
  [{ kind: 'default' }, '默认价格'],
  [{ kind: 'manual' }, '手动定价'],
  [{ kind: 'saved' }, '原订单价（历史来源未留存）'],
  [{ kind: 'unknown' }, '价格来源未提供'],
  [undefined, '价格来源未提供'],
])('价格解释仅依据实际来源 %#', (priceExplanation, label) => {
  render({ ...item, priceExplanation } as DraftItem)
  expect(host.textContent).toContain(label)
  if (priceExplanation?.kind !== 'price_list') expect(host.textContent).not.toContain('客户价格表：')
  expect(host.querySelector<HTMLInputElement>('[data-entry-field="item-1-price"]')!.value).toBe('120')
  expect(host.textContent).toContain('240.00')
})

test('录入单位同时解释计价单位和基本数量，选择事件不改写数值', () => {
  render(item)
  expect(host.textContent).toContain('每箱')
  expect(host.textContent).toContain('基本数量：24 个')
  const select = host.querySelector<HTMLSelectElement>('select[title="录入单位"]')!
  act(() => { select.value = '个'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(updateItem).toHaveBeenCalledWith(1, 'entryUnit', '个')
  render({ ...item, entryUnit: '个' })
  expect(host.textContent).toContain('每个')
  expect(host.textContent).toContain('基本数量：2 个')
  render({ ...item, entryUnit: undefined, units: [] })
  expect(host.textContent).toContain('每个')
  expect(host.textContent).toContain('基本数量：2 个')
})


test.each([{ units: [] }, { units: [{ unitName: '箱', conversionRate: 0, isBase: false }] }, { units: [{ unitName: '箱', conversionRate: Number.NaN, isBase: false }] }])('辅助单位未获得合法换算时不把系数1当作确证量 %#', ({ units }) => {
  render({ ...item, units })
  expect(host.textContent).toContain('基本数量：待确认换算')
  expect(host.textContent).not.toContain('基本数量：2 个')
  expect(host.textContent).toContain('240.00')
})

test.each(['success', 'failure'] as const)('历史箱单位异步 %s 保留原价与干净状态，基本数量仅在成功取得换算后显示', async outcome => {
  let resolve!: (product: Awaited<ReturnType<typeof getProductApi>>) => void
  let reject!: (error: Error) => void
  vi.mocked(getProductApi).mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
  const order = { customerId: 1, warehouseId: 1, items: [{ productId: 10, productCode: 'P10', productName: '铰链', unit: '个', entryUnit: '箱', entryQty: 2, quantity: 24, unitPrice: 10, amount: 240 }] } as NonNullable<Parameters<typeof useSaleOrderForm>[1]>
  let form!: ReturnType<typeof useSaleOrderForm>
  function SavedRows() { form = useSaleOrderForm('/sale/1', order); return <SaleOrderItemsTable {...form} /> }
  act(() => root.render(<MemoryRouter><SavedRows /></MemoryRouter>))
  expect(host.textContent).toContain('基本数量：待确认换算')
  expect(form.isDirty).toBe(false)
  await act(async () => {
    if (outcome === 'success') resolve({ units: item.units } as Awaited<ReturnType<typeof getProductApi>>)
    else reject(new Error('单位读取失败'))
  })
  expect(host.textContent).toContain(outcome === 'success' ? '基本数量：24 个' : '基本数量：待确认换算')
  expect(host.textContent).toContain('原订单价（历史来源未留存）')
  expect(form.isDirty).toBe(false)
  expect(form.items[0]).toMatchObject({ quantity: 2, unitPrice: 120, entryUnit: '箱' })
  expect(form.total).toBe(240)
})
