// @vitest-environment jsdom
//
// 商品 Finder 的**新鲜度与选中一致性**回归（2026-09-28，取证见
// docs/finder-stale-cache-investigation-2026-09-28.md）。
//
// 期望行为（修复目标）：
//   ① 每次参数激活都取新值——重开后重复搜索同一关键词、同次打开 A→B→A 都要重新取数
//      （`refetchOnMount:'always'` 只作用于挂载，覆盖不到同一次挂载内的 key 变化）；
//   ② 确认 / 双击 / Enter 一律回传**当前展示行**，而不是"选中那一刻"的旧对象；
//   ③ `pending`（含延迟响应）/ `isError` / 选中行已不在当前列表时，**不得确认**。
//
// 用**真实** `ProductFinderModal` + **真实** `QueryClient`（与生产同 `staleTime`），只 mock 边界接口。
// 注意：`tbody tr` 在加载态与空态也会有一行，故**等真实商品行必须按可见文案/售价**，不能只数行数。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProductFinderModal from './ProductFinderModal'
import { getProductsForFinderApi } from '@/api/products'
import { getCategoryTreeApi } from '@/api/categories'

vi.mock('@/api/products', () => ({ getProductsForFinderApi: vi.fn() }))
vi.mock('@/api/categories', () => ({ getCategoryTreeApi: vi.fn(async () => []) }))
vi.mock('@/components/shared/AppDialog', () => ({
  AppDialog: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) => <div>{children}{footer}</div>,
}))

type Row = Record<string, unknown>
const makeRow = (salePrice: number): Row => ({
  id: 153, code: 'P000001', name: '取证商品', skuCode: null, articleNumber: null,
  categoryId: 1, categoryName: '分类', categoryPath: '分类',
  supplierId: 64, supplierName: '供应商', unit: '个', spec: 'FX1', color: '黑', barcode: null,
  allowDecimalQty: true, stock: 0, salePrice, salePriceA: salePrice,
  salePriceB: null, salePriceC: null, salePriceD: null, costPrice: 50,
})
const page = (salePrice: number) => ({ list: [makeRow(salePrice)], pagination: { page: 1, pageSize: 30, total: 1 } })
const emptyPage = { list: [] as Row[], pagination: { page: 1, pageSize: 30, total: 0 } }

let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 * 60 * 5 } } })
  vi.mocked(getProductsForFinderApi).mockReset()
  vi.mocked(getCategoryTreeApi).mockResolvedValue([] as never)
})
afterEach(() => {
  act(() => root.unmount())
  client.clear()
  host.remove()
})

async function mount(onConfirm: (p: unknown) => void = () => {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ProductFinderModal open mode="sale" onConfirm={onConfirm as never} onClose={() => {}} />
      </QueryClientProvider>,
    )
  })
}
const rows = () => [...host.querySelectorAll<HTMLTableRowElement>('table tbody tr')]
const btn = (label: string) => [...host.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined
/** 等**真实商品行**（按可见售价），而不是 tbody 行数（加载/空态也有一行） */
const waitProductRow = async (price: number) => {
  await vi.waitFor(() => expect(host.textContent).toContain(`¥${price.toFixed(2)}`))
  await vi.waitFor(() => expect(rows().some(r => r.textContent?.includes('取证商品'))).toBe(true))
}
const keywords = () => vi.mocked(getProductsForFinderApi).mock.calls.map(c => (c[0] as { keyword?: string }).keyword)

function setNativeValue(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
}
/** 输入关键词并越过 300ms debounce */
async function typeKeyword(k: string) {
  const input = host.querySelector('input') as HTMLInputElement
  await act(async () => {
    setNativeValue(input, k)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
  })
}
const productRow = () => rows().find(r => r.textContent?.includes('取证商品'))!

it('★ 重开后重复搜索同一关键词：仍要重新取数并显示新值', async () => {
  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(100) as never)
  await mount()
  await waitProductRow(100)
  await typeKeyword('A')
  await vi.waitFor(() => expect(keywords().filter(k => k === 'A').length).toBe(1))

  // 关闭（卸载）→ 重开（新挂载）
  await act(async () => { root.render(<QueryClientProvider client={client}><div /></QueryClientProvider>) })
  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(150) as never)
  await mount()
  await typeKeyword('A')

  // 断言的是"**第二次** A 请求真的发生"，而不只是总调用数
  await vi.waitFor(() => expect(keywords().filter(k => k === 'A').length).toBe(2))
  await waitProductRow(150)
})

it('★ 同次打开 A→B→A：回到 A 也要重新取数并显示新值', async () => {
  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(100) as never)
  await mount()
  await waitProductRow(100)
  await typeKeyword('A')
  await vi.waitFor(() => expect(keywords()).toContain('A'))
  await typeKeyword('B')
  await vi.waitFor(() => expect(keywords()).toContain('B'))

  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(150) as never)
  await typeKeyword('A')

  // A 应被请求**两次**（第一次进入 A、第二次回到 A），且回到 A 后显示新值
  await vi.waitFor(() => expect(keywords().filter(k => k === 'A').length).toBe(2))
  await waitProductRow(150)
})

it('★ 延迟响应期间不得确认（页脚 / 双击 / Enter 都不回调）', async () => {
  let release: (v: unknown) => void = () => {}
  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(100) as never)
  const onConfirm = vi.fn()
  await mount(onConfirm)
  await waitProductRow(100)

  await act(async () => { productRow().click() })
  await vi.waitFor(() => expect(host.textContent).toContain('已选商品'))
  await vi.waitFor(() => expect(btn('确认选择')?.disabled).toBe(false))

  // 让下一次取数**悬挂**（不 await 失效本身，否则会卡死）
  vi.mocked(getProductsForFinderApi).mockImplementation(() => new Promise(res => { release = res as unknown as (v: unknown) => void }))
  await act(async () => { void client.invalidateQueries({ queryKey: ['products'] }) })
  await vi.waitFor(() => expect(host.textContent).toContain('正在查询…'))

  expect(btn('确认选择')?.disabled).toBe(true)
  await act(async () => { btn('确认选择')!.click() })
  await act(async () => { rows()[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await act(async () => { rows()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(onConfirm).not.toHaveBeenCalled()

  await act(async () => { release(page(150) as never) })
  await waitProductRow(150)
})

it('★ refetch 后页脚确认、双击、Enter 都回传**当前展示行**', async () => {
  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(100) as never)
  const onConfirm = vi.fn()
  await mount(onConfirm)
  await waitProductRow(100)

  await act(async () => { productRow().click() })

  // 外部改价 + 真实失效重取 ⇒ 表格变为 150
  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(150) as never)
  await act(async () => { await client.invalidateQueries({ queryKey: ['products'] }) })
  await waitProductRow(150)

  await act(async () => { btn('确认选择')!.click() })
  expect(onConfirm).toHaveBeenCalledTimes(1)
  expect((onConfirm.mock.calls[0][0] as { salePrice: number }).salePrice).toBe(150)

  onConfirm.mockClear()
  await act(async () => { productRow().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  expect((onConfirm.mock.calls[0][0] as { salePrice: number }).salePrice).toBe(150)

  onConfirm.mockClear()
  await act(async () => { productRow().click() })
  await act(async () => { productRow().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect((onConfirm.mock.calls[0][0] as { salePrice: number }).salePrice).toBe(150)
})

it('★ 选中行已不在新列表时不得确认', async () => {
  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(100) as never)
  await mount()
  await waitProductRow(100)
  await act(async () => { productRow().click() })
  await vi.waitFor(() => expect(btn('确认选择')?.disabled).toBe(false))

  vi.mocked(getProductsForFinderApi).mockResolvedValue(emptyPage as never)
  await act(async () => { await client.invalidateQueries({ queryKey: ['products'] }) })
  await vi.waitFor(() => expect(host.textContent).not.toContain('¥100.00'))
  expect(btn('确认选择')?.disabled).toBe(true)
})

it('★ 查询出错时不得确认（等错误态真正显示）', async () => {
  vi.mocked(getProductsForFinderApi).mockResolvedValue(page(100) as never)
  await mount()
  await waitProductRow(100)
  await act(async () => { productRow().click() })

  vi.mocked(getProductsForFinderApi).mockRejectedValue(new Error('boom'))
  await act(async () => { await client.invalidateQueries({ queryKey: ['products'] }) })
  await vi.waitFor(() => expect(host.textContent).toContain('商品加载失败'))
  expect(btn('确认选择')?.disabled).toBe(true)
})
