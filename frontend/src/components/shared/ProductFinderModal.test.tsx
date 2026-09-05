// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ProductFinderModal from './ProductFinderModal'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const finder = vi.hoisted(() => ({ params: {} as Record<string, unknown> }))
vi.mock('@/hooks/useProducts', () => ({ useProductFinder: (params: Record<string, unknown>) => {
  finder.params = params
  return { data: { list: [{ id: 1, code: 'P001', name: '连接器', articleNumber: 'SUP-01', spec: 'M6', color: '黑', unit: '个', salePrice: 10, stock: 5, supplierName: '供应商一', barcode: '690001' }], pagination: { total: 65 } }, isFetching: false, isLoading: false, refetch: vi.fn() }
} }))
vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: [{ id: 1, name: '配件', children: [{ id: 2, name: '连接器' }] }], refetch: vi.fn() }) }))
vi.mock('@/components/shared/AppDialog', () => ({ AppDialog: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => <div>{children}{footer}</div> }))
const hosts: HTMLDivElement[] = []
async function mount(context: { mode?: 'lookup' | 'sale' | 'purchase'; warehouseId?: number; warehouseName?: string } = {}) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  await act(async () => root.render(<ProductFinderModal open {...context} onClose={() => {}} onConfirm={() => {}} />))
  return { host, root }
}
afterEach(() => { hosts.splice(0).forEach(h => h.remove()) })
it('分页后清空选择，默认查询场景不显示价格和无仓库存列', async () => {
  const { host, root } = await mount()
  const next = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('下一页'))!
  expect(next).toBeTruthy()
  const confirm = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '确认选择')!
  await act(async () => host.querySelector<HTMLTableRowElement>('tbody tr')!.click())
  expect(confirm.disabled).toBe(false)
  await act(async () => next.click())
  expect(confirm.disabled).toBe(true)
  expect(finder.params.page).toBe(2)
  expect(host.textContent).not.toContain('售价')
  expect(host.textContent).not.toContain('可用库存')
  await act(async () => root.unmount())
})
it('父分类可以独立选择并筛选全部子分类', async () => {
  const { host, root } = await mount()
  const category = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '配件')!
  await act(async () => category.click())
  expect(finder.params.categoryId).toBe(1)
  await act(async () => root.unmount())
})

it('销售场景明确展示仓库、参考售价和选中商品条码', async () => {
  const { host, root } = await mount({ mode: 'sale', warehouseId: 2, warehouseName: '北京主仓' })
  expect(finder.params.warehouseId).toBe(2)
  expect(host.textContent).toContain('库存参考：北京主仓')
  expect(host.textContent).toContain('参考售价')
  await act(async () => host.querySelector<HTMLTableRowElement>('tbody tr')!.click())
  expect(host.textContent).toContain('690001')
  expect(host.textContent).toContain('实际成交价以订单为准')
  await act(async () => root.unmount())
})
