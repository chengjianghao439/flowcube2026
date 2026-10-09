// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api, { setApiClientBaseURL } from '@/api/client'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { ProductFinderResult } from '@/types/products'
import ProductFinderModal from './ProductFinderModal'

const oldAdapter = api.defaults.adapter
const product: ProductFinderResult = {
  id: 41, code: 'P41', name: '受控商品', skuCode: null, articleNumber: 'SUP-41',
  categoryId: 2, categoryName: '连接件', categoryPath: '五金 > 连接件', supplierId: 9,
  supplierName: '受控供应商', unit: '个', spec: 'M4', color: '银色', barcode: '690041',
  costPrice: 2, salePrice: 10, stock: 3, allowDecimalQty: false,
}
const categories = [{ id: 1, name: '五金', children: [{ id: 2, name: '连接件', children: [] }] }]
const page = (list: ProductFinderResult[], currentPage = 1, total = list.length, pageSize = 200) => ({ list, pagination: { page: currentPage, pageSize, total } })
let host: HTMLDivElement, root: Root, cache: QueryClient, active: boolean, open: boolean
let respond: (config: InternalAxiosRequestConfig) => Promise<unknown>
const confirmed = vi.fn(), closed = vi.fn(), requests: InternalAxiosRequestConfig[] = [], releases: (() => void)[] = []
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear(); localStorage.clear(); setApiClientBaseURL('/original/api')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('innerWidth', 1600); vi.stubGlobal('innerHeight', 1000)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-table-scroll') ? 480 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1120)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-table-scroll]'), height = this.hasAttribute('data-table-scroll') ? 480 : this.tagName === 'TR' ? 48 : 0
    return { height, width: 1120, top: this === scroll ? 0 : -(scroll?.scrollTop || 0), left: 0, bottom: height, right: 1120, x: 0, y: 0, toJSON() {} }
  })
  useAuthStore.getState().login('offline-product-fixture', null, { id: 9, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 2, permissions: [PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.CATEGORY_VIEW] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300000 } } })
  active = true; open = true; requests.length = 0; releases.length = 0; confirmed.mockReset(); closed.mockReset()
  respond = async config => config.url === '/categories/tree' ? categories : page([product])
  api.defaults.adapter = (async config => {
    requests.push(config)
    if (config.method !== 'get' || !['/products/finder', '/categories/tree'].includes(config.url!)) throw Error(`禁止真实网络 ${config.method} ${config.url}`)
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: await respond(config) } }
  }) satisfies AxiosAdapter
})
afterEach(async () => {
  await act(async () => { releases.forEach(release => release()); root.unmount() })
  cache.clear(); host.remove(); document.body.innerHTML = ''; api.defaults.adapter = oldAdapter
  useAuthStore.setState({ token: null, user: null }); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function draw() {
  await act(async () => root.render(<QueryClientProvider client={cache}><SectionVisibilityContext.Provider value={active}>
    <ProductFinderModal compact open={open} mode="sale" warehouseId={1} warehouseName="受控仓库" onConfirm={confirmed} onClose={closed} />
  </SectionVisibilityContext.Provider></QueryClientProvider>))
}
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!
const row = (name = product.name) => [...document.querySelectorAll<HTMLTableRowElement>('tbody tr:not([aria-hidden])')].find(r => r.textContent?.includes(name))!
const reads = () => requests.filter(r => r.url === '/products/finder')
async function ready(name = product.name) { await vi.waitFor(() => expect(row(name)).toBeTruthy()); await vi.waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull()) }
async function click(label: string) { await act(async () => button(label).click()) }
async function type(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="搜索商品"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) })
}

test('compact removes persistent instructions while retaining real identity and integer policy', async () => {
  await draw(); await ready()
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.style.width).toBe('1240px'); expect(dialog.style.height).toBe('660px')
  expect(document.querySelector('aside')!.classList.contains('w-44')).toBe(true)
  expect(document.body.textContent).not.toContain('单击选择')
  expect(document.body.textContent).not.toContain('选择商品后，在这里')
  expect(document.body.textContent).toContain('只能整数')
  for (const field of ['P41', 'SUP-41', 'M4', '受控商品', '银色']) expect(row().textContent).toContain(field)
  await act(async () => row().click())
  expect(document.body.textContent).toContain('五金 > 连接件')
  expect(document.body.textContent).toContain('690041')
  expect(document.body.textContent).not.toContain('实际成交价以订单为准')
})

test('compact reads all bounded batches and scrolls a real virtual body to the last result', async () => {
  const products = Array.from({ length: 230 }, (_, i) => ({ ...product, id: i + 1, code: `P${i + 1}`, name: `完整商品 ${i + 1}` }))
  respond = async config => config.url === '/categories/tree' ? categories : page(products.slice((config.params.page - 1) * 200, config.params.page * 200), config.params.page, products.length)
  await draw(); await ready('完整商品 1')
  expect(reads().map(r => r.params)).toEqual([1, 2].map(page => expect.objectContaining({ page, pageSize: 200, warehouseId: 1 })))
  expect(document.body.textContent).not.toContain('上一页'); expect(document.body.textContent).not.toContain('下一页')
  expect(document.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  await act(async () => row('完整商品 1').click())
  const scroll = document.querySelector<HTMLElement>('[data-table-scroll]')!
  await act(async () => { scroll.scrollTop = products.length * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  expect(row('完整商品 230')).toBeTruthy()
  expect(button('确认选择').disabled).toBe(false)
  expect([...document.querySelectorAll('[aria-live="polite"]')].some(node => node.textContent?.includes('已选商品') && node.textContent.includes('完整商品 1'))).toBe(true)
  await act(async () => row('完整商品 230').click())
  await click('确认选择')
  expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ id: 230, code: 'P230', allowDecimalQty: false, categoryPath: product.categoryPath, costPrice: 2 }))
})

test('compact queries keyword and descendant category remotely and blocks unsubmitted old selection', async () => {
  respond = async config => config.url === '/categories/tree' ? categories : page([{ ...product, name: config.params.keyword ? '远端匹配商品' : product.name, searchMatch: config.params.keyword ? '供应商型号' : undefined }])
  await draw(); await ready(); await act(async () => row().click())
  await click('五金'); await ready()
  expect(button('确认选择').disabled).toBe(true)
  await act(async () => row().click())
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="搜索商品"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '未提交输入')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirmed).not.toHaveBeenCalled()
  await type('跨批型号'); await ready('远端匹配商品')
  expect(reads().at(-1)?.params).toMatchObject({ keyword: '跨批型号', categoryId: 1, warehouseId: 1, page: 1, pageSize: 200 })
  await act(async () => row('远端匹配商品').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirmed.mock.calls[0][0]).not.toHaveProperty('searchMatch')
})

test('compact synchronously allows one confirmation across footer, double-click and Enter', async () => {
  await draw(); await ready(); await act(async () => row().click())
  await act(async () => {
    button('确认选择').click(); button('确认选择').click()
    row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  expect(confirmed).toHaveBeenCalledOnce(); expect(closed).toHaveBeenCalledOnce()
})

test('compact exposes the 5000 limit and rejects every confirmation for incomplete results', async () => {
  respond = async config => {
    if (config.url === '/categories/tree') return categories
    const n = Number(config.params.page)
    return page(Array.from({ length: 200 }, (_, i) => ({ ...product, id: (n - 1) * 200 + i + 1 })), n, 5100)
  }
  await draw(); await ready()
  expect(reads()).toHaveLength(25)
  expect(document.body.textContent).toContain('5,000'); expect(document.body.textContent).toContain('5,100')
  expect(document.body.textContent).toContain('缩小搜索范围')
  await act(async () => row().click())
  expect(button('确认选择').disabled).toBe(true)
  await act(async () => { row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(confirmed).not.toHaveBeenCalled()
})

test('compact cancellation keeps the original close/reopen reset and cannot refill from an old node', async () => {
  await draw(); await ready(); await type('旧输入'); await ready(); await act(async () => row().click())
  const old = row()
  await click('取消')
  await act(async () => old.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirmed).not.toHaveBeenCalled(); expect(closed).toHaveBeenCalledOnce()
  open = false; await draw(); open = true; await draw(); await ready()
  expect(document.querySelector<HTMLInputElement>('[aria-label="搜索商品"]')!.value).toBe('')
  expect(button('确认选择').disabled).toBe(true)
})

test('compact without supplied owner stops hidden continuation and binds resumed reads to the original scope', async () => {
  respond = async config => {
    if (config.url === '/categories/tree') return categories
    const n = Number(config.params.page)
    if (n === 1) await new Promise<void>(resolve => { releases.push(resolve) })
    return page([{ ...product, id: n }], n, 2, 1)
  }
  await draw(); await vi.waitFor(() => expect(reads()).toHaveLength(1))
  active = false; await draw()
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(reads()).toHaveLength(1); expect(document.querySelector('[role="dialog"]')).toBeNull()
  active = true; await draw(); await vi.waitFor(() => expect(reads()).toHaveLength(2))
  await act(async () => { releases[1](); await Promise.resolve() }); await ready()
  expect(reads().map(r => r.params.page)).toEqual([1, 1, 2])
  expect(requests.every(r => r.baseURL === '/original/api' && r._erpApiFallbackTried && r.automaticReplay === false)).toBe(true)
})

test('local compact preserves inputs after source ABA and allows explicit close before a fresh reopening', async () => {
  await draw(); await ready(); await type('保留的输入'); await ready(); const old = row(), count = requests.length
  await act(async () => { setApiClientBaseURL('/other/api'); setApiClientBaseURL('/original/api') })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.body.textContent).toContain('读取来源已变化')
  expect(document.querySelector<HTMLInputElement>('[aria-label="搜索商品"]')!.value).toBe('保留的输入')
  expect(button('确认选择').disabled).toBe(true)
  expect(requests).toHaveLength(count)
  expect(closed).not.toHaveBeenCalled()
  await act(async () => old.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirmed).not.toHaveBeenCalled()
  active = false; await draw(); expect(document.querySelector('[role="dialog"]')).toBeNull()
  active = true; await draw(); expect(document.body.textContent).toContain('读取来源已变化')
  await click('取消'); expect(closed).toHaveBeenCalledOnce()
  open = false; await draw(); open = true; await draw(); await ready()
  expect(document.body.textContent).not.toContain('读取来源已变化')
  expect(document.querySelector<HTMLInputElement>('[aria-label="搜索商品"]')!.value).toBe('')
})

test('compact keeps a normal token renewal in the same session readable', async () => {
  await draw(); await ready()
  const generation = useAuthStore.getState().sessionGeneration
  await act(async () => useAuthStore.getState().setTokens('renewed-offline-fixture', null))
  expect(useAuthStore.getState().sessionGeneration).toBe(generation)
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirmed).toHaveBeenCalledWith(product)
})

test('compact confirmation derives refreshed identity and price from the current complete list', async () => {
  await draw(); await ready(); await act(async () => row().click())
  respond = async config => config.url === '/categories/tree' ? categories : page([{ ...product, name: '更新的商品', salePrice: 20, costPrice: 4 }])
  await act(async () => { await cache.invalidateQueries({ queryKey: ['products'] }) }); await ready('更新的商品')
  await click('确认选择')
  expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ id: 41, name: '更新的商品', salePrice: 20, costPrice: 4 }))
})
