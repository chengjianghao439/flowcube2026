// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api, { setApiClientBaseURL } from '@/api/client'
import ProductFinder from './ProductFinderModal'
import { captureReorderOwner } from '@/lib/saleReorder'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import type { ProductFinderResult } from '@/types/products'
const product: ProductFinderResult = { id: 41, code: 'P41', name: '当前商品', skuCode: null, articleNumber: null, categoryId: 1, categoryName: '分类', categoryPath: '分类', supplierId: null, supplierName: null, unit: '个', spec: null, color: null, salePrice: 10, costPrice: 5, stock: 2 }
const oldAdapter = api.defaults.adapter
let host: HTMLDivElement, root: Root, cache: QueryClient, owner: ReturnType<typeof captureReorderOwner>, active: boolean, interactive: boolean, open: boolean
let release: (() => void) | undefined, defer: boolean
const requests: InternalAxiosRequestConfig[] = [], confirmed = vi.fn(), closed = vi.fn()
const page = (name = product.name) => ({ list: [{ ...product, name }], pagination: { page: 1, pageSize: 30, total: 1 } })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); setApiClientBaseURL('/a')
  useAuthStore.getState().login('offline', null, { id: 9, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 2, permissions: [P.SALE_ORDER_CREATE, P.PRODUCT_VIEW, P.CATEGORY_VIEW] })
  owner = captureReorderOwner(); active = true; interactive = true; open = true; defer = false; release = undefined; requests.length = 0; confirmed.mockClear(); closed.mockClear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  api.defaults.adapter = (async config => {
    requests.push(config)
    if (config.method !== 'get' || !['/products/finder', '/categories/tree'].includes(config.url!)) throw Error(`Forbidden finder API ${config.method} ${config.url}`)
    if (config.url === '/products/finder' && defer) await new Promise<void>(resolve => { release = resolve })
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: config.url === '/categories/tree' ? [] : page() } }
  }) satisfies AxiosAdapter
})
afterEach(async () => { release?.(); await act(async () => root.unmount()); cache.clear(); host.remove(); document.body.innerHTML = ''; api.defaults.adapter = oldAdapter; useAuthStore.setState({ token: null, user: null }); vi.restoreAllMocks() })
async function draw() { await act(async () => root.render(<QueryClientProvider client={cache}><SectionVisibilityContext.Provider value={active}><ProductFinder open={open} readOwner={owner} readGuard={() => interactive} mode="sale" onConfirm={confirmed} onClose={closed} /></SectionVisibilityContext.Provider></QueryClientProvider>)) }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function type(value: string) { const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索商品"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) }); await flush() }
const row = () => [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(node => node.textContent?.includes('当前商品'))!
it.each(['serverABA', 'actorABA', 'permission'])('R9实际Finder读取在%s后隔离迟到列表及回填，不转到新endpoint', async change => {
  defer = true; await draw(); await flush()
  expect(requests.filter(r => r.url === '/products/finder')).toHaveLength(1)
  await act(async () => {
    if (change === 'serverABA') { setApiClientBaseURL('/b'); setApiClientBaseURL('/a') }
    if (change === 'actorABA') { const original = useAuthStore.getState().user!; useAuthStore.setState({ user: { ...original, id: 10 } }); useAuthStore.setState({ user: original }) }
    if (change === 'permission') useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [P.SALE_ORDER_CREATE] } }))
  })
  await act(async () => { release!(); await Promise.resolve() }); await flush()
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.body.textContent).not.toContain('当前商品'); expect(confirmed).not.toHaveBeenCalled()
  expect(requests.every(r => r.baseURL === '/a')).toBe(true)
})
it.each(['hidden', 'unknown-save'])('R9 %s暂停真实Finder不卸载输入，迟到读取不露出；恢复用新代次读取', async change => {
  await draw(); await flush(); defer = true; await type('保留关键词')
  try {
    if (change === 'hidden') active = false; else interactive = false
    await draw(); expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => { release!(); await Promise.resolve() }); await flush()
    const count = requests.length; await act(async () => { void cache.invalidateQueries({ queryKey: ['products'] }) }); await flush(); expect(requests).toHaveLength(count)
    active = true; interactive = true; defer = false; await draw(); await flush()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="搜索商品"]')!.value).toBe('保留关键词')
    expect(requests.filter(r => r.url === '/products/finder')).toHaveLength(3)
  } finally { release?.() }
})
it('旧行双击回调实时核未决冻结，不靠fieldset；当前合法列表正常选回', async () => {
  await draw(); await flush(); const old = row(); interactive = false
  await act(async () => old.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirmed).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
  interactive = true; await draw(); await act(async () => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirmed).toHaveBeenCalledWith(product); expect(closed).toHaveBeenCalledTimes(1)
})
it('R9无分类查看权不读分类，商品查看权合法时仍可选品', async () => {
  useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [P.SALE_ORDER_CREATE, P.PRODUCT_VIEW] } })); owner = captureReorderOwner()
  await draw(); await flush(); expect(row()).toBeTruthy(); expect(requests.map(r => r.url)).toEqual(['/products/finder'])
})
it('R9首批挂起后隐藏，不让自动取齐发第二批；默认完整列表契约保留', async () => {
  api.defaults.adapter = (async config => {
    requests.push(config)
    if (config.method !== 'get' || !['/products/finder', '/categories/tree'].includes(config.url!)) throw Error(`Forbidden finder API ${config.url}`)
    let value: unknown = []
    if (config.url === '/products/finder') {
      const number = Number(config.params.page)
      if (number === 1) await new Promise<void>(resolve => { release = resolve })
      value = { list: [{ ...product, id: 40 + number }], pagination: { page: number, pageSize: 1, total: 2 } }
    }
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: value } }
  }) satisfies AxiosAdapter
  await draw(); await flush(); active = false; await draw()
  await act(async () => { release!(); await Promise.resolve() }); await flush()
  expect(requests.filter(r => r.url === '/products/finder').map(r => r.params.page)).toEqual([1])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  active = true; await draw(); await flush()
  await act(async () => { release!(); await Promise.resolve() }); await flush()
  expect(requests.filter(r => r.url === '/products/finder').map(r => r.params.page)).toEqual([1, 1, 2])
  expect([...document.querySelectorAll('tbody tr')].filter(node => node.textContent?.includes('当前商品'))).toHaveLength(2)
})
