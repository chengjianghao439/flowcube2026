// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DraftItem } from '../validate'
import type { EntryIssue } from '@/lib/orderEntry'
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
function render(row: DraftItem, compact = false, lockedIdentity = false, issues: EntryIssue[] = [], priceErrors: Record<number, string> = {}) {
  act(() => root.render(<MemoryRouter><SaleOrderItemsTable compact={compact} lockedIdentity={lockedIdentity} issues={issues} priceErrors={priceErrors} items={[row]} invalidItemKeys={new Set()} quantityRefs={{ current: new Map() }} priceLoading={{}} setFinderItemKey={vi.fn()} setFinderOpen={vi.fn()} updateItem={updateItem} removeItem={vi.fn()} /></MemoryRouter>))
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
])('价格来源不再展示，保留原单价和金额 %#', (priceExplanation, label) => {
  render({ ...item, priceExplanation } as DraftItem)
  expect(host.textContent).not.toContain(label)
  if (priceExplanation?.kind !== 'price_list') expect(host.textContent).not.toContain('客户价格表：')
  expect(host.querySelector<HTMLInputElement>('[data-entry-field="item-1-price"]')!.value).toBe('120')
  expect(host.textContent).toContain('240.00')
})

test('删除量价常驻小字，录入单位选择仍不改写数值', () => {
  render(item)
  expect(host.textContent).not.toContain('每箱')
  expect(host.textContent).not.toContain('基本数量：')
  const select = host.querySelector<HTMLSelectElement>('select[title="录入单位"]')!
  act(() => { select.value = '个'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(updateItem).toHaveBeenCalledWith(1, 'entryUnit', '个')
  render({ ...item, entryUnit: '个' })
  expect(host.textContent).not.toContain('每个')
  expect(host.textContent).not.toContain('基本数量：')
  render({ ...item, entryUnit: undefined, units: [] })
  expect(host.textContent).not.toContain('每个')
  expect(host.textContent).not.toContain('基本数量：')
})


test.each([{ units: [] }, { units: [{ unitName: '箱', conversionRate: 0, isBase: false }] }, { units: [{ unitName: '箱', conversionRate: Number.NaN, isBase: false }] }])('辅助单位未获得合法换算时不把系数1当作确证量 %#', ({ units }) => {
  render({ ...item, units })
  expect(host.textContent).toContain('换算待确认')
  expect(host.textContent).not.toContain('基本数量：2 个')
  expect(host.textContent).toContain('240.00')
})

test.each([false, true].flatMap(compact => (['success', 'failure'] as const).map(outcome => ({ compact, outcome }))))('历史箱单位compact=$compact 异步$outcome保留原价与干净状态，真实换算风险仅在未取得换算时显示', async ({ compact, outcome }) => {
  let resolve!: (product: Awaited<ReturnType<typeof getProductApi>>) => void
  let reject!: (error: Error) => void
  vi.mocked(getProductApi).mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
  const order = { customerId: 1, warehouseId: 1, items: [{ productId: 10, productCode: 'P10', productName: '铰链', unit: '个', entryUnit: '箱', entryQty: 2, quantity: 24, unitPrice: 10, amount: 240 }] } as NonNullable<Parameters<typeof useSaleOrderForm>[1]>
  let form!: ReturnType<typeof useSaleOrderForm>
  function SavedRows() { form = useSaleOrderForm('/sale/1', order); return <SaleOrderItemsTable {...form} compact={compact} /> }
  act(() => root.render(<MemoryRouter><SavedRows /></MemoryRouter>))
  expect(host.textContent).toContain('换算待确认')
  expect(form.isDirty).toBe(false)
  await act(async () => {
    if (outcome === 'success') resolve({ units: item.units } as Awaited<ReturnType<typeof getProductApi>>)
    else reject(new Error('单位读取失败'))
  })
  expect(host.textContent.includes('换算待确认')).toBe(outcome !== 'success')
  expect(host.textContent).not.toContain('基本数量：')
  expect(host.textContent).not.toContain('原订单价（历史来源未留存）')
  expect(form.isDirty).toBe(false)
  expect(form.items[0]).toMatchObject({ quantity: 2, unitPrice: 120, entryUnit: '箱' })
  expect(form.total).toBe(240)
})


test('紧凑明细保留商品身份、单价金额、包装换算与独立行备注', () => {
  const row = { ...item, productName: '超长名称铰链用于检查完整商品身份呈现与换行', productCode: 'P10-完整编码', articleNumber: 'H10-完整供应商型号', spec: '直臂-完整型号', color: '银色-完整颜色', remark: '按箱分装', priceExplanation: { kind: 'saved' } } as DraftItem
  render(row, true)
  expect([...host.querySelectorAll('th')].map(header => header.textContent)).toEqual(['商品', '数量', '单位', '单价 (¥)', '金额', '备注', '操作'])
  const identity = host.querySelector('tbody tr td')!
  for (const value of [row.productName, row.productCode, row.articleNumber, row.spec, row.color]) expect(identity.textContent).toContain(value)
  expect(host.textContent).not.toContain('原订单价（历史来源未留存）')
  expect(host.textContent).not.toContain('基本数量：')
  expect(host.textContent).not.toContain('每箱')
  expect(host.querySelector<HTMLInputElement>('[data-entry-field="item-1-price"]')!.value).toBe('120')
  expect(host.textContent).toContain('240.00')
  const note = host.querySelector<HTMLInputElement>(`input[aria-label="${row.productName}备注"]`)!
  expect(note.value).toBe('按箱分装')
  expect(note.maxLength).toBe(200)
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(note, '')
    note.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(updateItem).toHaveBeenCalledWith(1, 'remark', '')
})

test('紧凑明细保留身份锁定和未知换算风险，不回退为基本量', () => {
  render({ ...item, units: [] }, true, true)
  expect(host.querySelector<HTMLButtonElement>('[data-entry-field="item-1-product"]')!.disabled).toBe(true)
  expect(host.querySelector<HTMLButtonElement>('[aria-label="删除商品行"]')!.disabled).toBe(true)
  expect(host.textContent).toContain('换算待确认')
  expect(host.textContent).not.toContain('基本数量：2 个')
  render(item, true, true)
  const unit = host.querySelector<HTMLSelectElement>('select[title="录入单位"]')!
  expect(unit.disabled).toBe(true)
  expect(host.querySelector<HTMLInputElement>('[data-entry-field="item-1-quantity"]')!.disabled).toBe(false)
})


test('紧凑明细错误在字段下显示且不重复已显示的取价错误', () => {
  const issues = [
    { target: 'item-1-quantity', itemKey: 1, message: '第 1 行（铰链）：数量最多保留两位小数' },
    { target: 'item-1-price', itemKey: 1, message: '第 1 行（铰链）：价格读取失败，请核对' },
  ]
  render({ ...item, quantity: 1.234 }, true, false, issues, { 1: '价格读取失败，请核对' })
  const quantity = host.querySelector<HTMLInputElement>('[data-entry-field="item-1-quantity"]')!
  expect(quantity.getAttribute('aria-invalid')).toBe('true')
  expect(quantity.closest('td')!.textContent).toContain('数量最多保留两位小数')
  expect([...host.querySelectorAll('[role="alert"]')].filter(node => node.textContent?.includes('价格读取失败，请核对'))).toHaveLength(1)
  expect(host.textContent).toContain('确认当前单价')
  render(item, true)
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
