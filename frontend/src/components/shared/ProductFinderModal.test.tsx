// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ProductFinderModal from './ProductFinderModal'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const finder = vi.hoisted(() => ({ params: {} as Record<string, unknown>, isFetching: false, isPlaceholderData: false }))
vi.mock('@/hooks/useProducts', () => ({ useProductFinder: (params: Record<string, unknown>) => {
  finder.params = params
  return { data: { list: [{ id: 1, code: 'P001', name: '连接器', articleNumber: 'SUP-01', spec: 'M6', color: '黑', unit: '个', salePrice: 10, stock: 5, supplierName: '供应商一', barcode: '690001', searchMatch: '供应商型号' }], pagination: { total: 65 } }, isFetching: finder.isFetching, isPlaceholderData: finder.isPlaceholderData, isLoading: false, refetch: vi.fn() }
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
afterEach(() => { hosts.splice(0).forEach(h => h.remove()); finder.isFetching = false; finder.isPlaceholderData = false })
it('完整商品列表无翻页，筛选变化清空选择，默认不显示价格和无仓库存列', async () => {
  const { host, root } = await mount()
  const next = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('下一页'))!
  expect(next).toBeUndefined()
  const confirm = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '确认选择')!
  await act(async () => host.querySelector<HTMLTableRowElement>('tbody tr')!.click())
  expect(confirm.disabled).toBe(false)
  const category = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '配件')!
  await act(async () => category.click())
  expect(confirm.disabled).toBe(true)
  expect(finder.params.categoryId).toBe(1)
  expect(host.textContent).not.toContain('售价')
  expect(host.textContent).not.toContain('可用库存')
  await act(async () => root.unmount())
})

it('placeholder与fetching禁旧项确认，仓库或mode变化重挂清空选择', async () => {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host); const confirm = vi.fn()
  const render = async (warehouseId = 1, mode: 'sale' | 'purchase' = 'sale') => {
    await act(async () => root.render(<ProductFinderModal open warehouseId={warehouseId} mode={mode} onClose={() => {}} onConfirm={confirm} />))
  }
  const button = () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '确认选择')!
  const select = async () => act(async () => host.querySelector<HTMLTableRowElement>('tbody tr')!.click())
  try {
    await render(); await select(); expect(button().disabled).toBe(false)
    for (const flag of ['isPlaceholderData', 'isFetching'] as const) {
      finder[flag] = true; await render()
      expect(button().disabled).toBe(true)
      await act(async () => {
        host.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))
        host.querySelector('tbody tr')!.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}))
      })
      expect(confirm).not.toHaveBeenCalled()
      finder[flag] = false; await render()
    }
    await render(2); expect(button().disabled).toBe(true)
    await select(); expect(button().disabled).toBe(false)
    await render(2, 'purchase'); expect(button().disabled).toBe(true)
  } finally { await act(async () => root.unmount()) }
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

it('有关键词才显示数据库命中说明，debounce旧选项不能确认且说明不回填', async () => {
  vi.useFakeTimers()
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  const confirm = vi.fn()
  try {
    await act(async () => root.render(<ProductFinderModal open onClose={() => {}} onConfirm={confirm} />))
    expect(host.textContent).not.toContain('命中：')
    await act(async () => {
      const input = host.querySelector('input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'SUP-01')
      input.dispatchEvent(new Event('input', {bubbles:true}))
    })
    await act(async () => host.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('dblclick', {bubbles:true})))
    expect(confirm).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(host.textContent).toContain('命中：供应商型号')
    await act(async () => host.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('dblclick', {bubbles:true})))
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0]).not.toHaveProperty('searchMatch')
    await act(async () => {
      const input = host.querySelector('input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
      input.dispatchEvent(new Event('input', {bubbles:true}))
    })
    expect(host.textContent).not.toContain('命中：')
  } finally { await act(async () => root.unmount()); vi.useRealTimers() }
})
