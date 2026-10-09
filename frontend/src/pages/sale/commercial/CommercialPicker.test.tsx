// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api, { setApiClientBaseURL } from '@/api/client'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { captureKitReadOwner } from '@/hooks/useKits'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import CommercialPicker from './CommercialPicker'

const oldAdapter = api.defaults.adapter
const product = {
  id: 41, code: 'P41', name: '当前商品', unit: '个', spec: 'M4', color: '银色', articleNumber: 'SUP-41',
  costPrice: 2, units: [{ unitName: '包', conversionRate: 10, isBase: false }], allowDecimalQty: false
}
const kit = {
  id: 1, code: 'K000001', name: '五金组合', unit: '组', currentVersionId: 7,
  spec: '组合型号', color: '银色', articleNumber: 'SUP-K1', costPrice: 80,
  version: { referenceUnitPrice: 100, salePriceB: 90, components: [
    { productId: 41, productCode: 'P41', productName: '当前商品', spec: 'M4', color: '银色', articleNumber: 'SUP-41', unit: '个', baseQty: 2, referencePrice: 2, amountWeight: 4 },
    { productId: 42, productCode: 'P42', productName: '固定螺钉', unit: '个', baseQty: 4, referencePrice: 1, amountWeight: 4 },
  ] }, selectable: true,
  disabledReasons: [], standaloneCompleteSetsByCurrentStock: 2
}
let host: HTMLDivElement, root: Root, owner: ReturnType<typeof captureKitReadOwner>
let active: boolean, interactive: boolean, epoch: number, kind: 'kit' | 'ordinary'
const selected = vi.fn(), closed = vi.fn(), requests: InternalAxiosRequestConfig[] = []
const releases: (() => void)[] = []
let respond: (config: InternalAxiosRequestConfig) => Promise<unknown>

function page(list: unknown[], currentPage = 1, total = list.length, pageSize = 100) { return { list, pagination: { total, pageSize, page: currentPage } } }
const categories = [{ id: 1, name: '五金', children: [{ id: 2, name: '连接件', children: [] }] }, { id: 3, name: '其他', children: [] }]
function enableCategories() { useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [...(s.user!.permissions ?? []), PERMISSIONS.CATEGORY_VIEW] } })) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear(); localStorage.clear(); setApiClientBaseURL('/original/api')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-table-scroll') ? 480 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1120)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-table-scroll]'), height = this.hasAttribute('data-table-scroll') ? 480 : this.tagName === 'TR' ? 48 : 0
    return { height, width: 1120, top: this === scroll ? 0 : -(scroll?.scrollTop || 0), left: 0, bottom: height, right: 1120, x: 0, y: 0, toJSON() {} }
  })
  useAuthStore.getState().login('offline-picker-fixture', null, {
    id: 9, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 2,
    permissions: [PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.PRODUCT_VIEW]
  })
  owner = captureKitReadOwner(); active = true; interactive = true; epoch = 1; kind = 'ordinary'
  requests.length = 0; releases.length = 0; selected.mockReset(); closed.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  respond = async config => config.url === '/categories/tree' ? categories : config.url === '/products/41' ? product : page([config.url === '/kits/finder' ? kit : product])
  api.defaults.adapter = (async config => {
    requests.push(config)
    if (config.method !== 'get' || !['/products/finder', '/kits/finder', '/products/41', '/categories/tree'].includes(config.url!))
      throw Error(`禁止真实网络，未提供选择器响应 ${config.method} ${config.url}`)
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: await respond(config) } }
  }) satisfies AxiosAdapter
})
afterEach(async () => {
  await act(async () => { releases.forEach(release => release()); root.unmount() })
  host.remove(); document.body.innerHTML = ''; api.defaults.adapter = oldAdapter
  useAuthStore.setState({ token: null, user: null }); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

async function draw() {
  await act(async () => root.render(<SectionVisibilityContext.Provider value={active}>
    <CommercialPicker kind={kind} warehouseId={1} owner={owner}
      readGuard={{ epoch, isCurrent: () => interactive }} onSelect={selected} onClose={closed} />
  </SectionVisibilityContext.Provider>))
}
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!
const searchInput = () => document.querySelector<HTMLInputElement>('[aria-label="搜索成交商品"]')!
async function click(label: string) { await act(async () => { button(label).click() }) }
async function search(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(searchInput(), value)
    searchInput().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('查询')
}
const row = () => document.querySelector<HTMLTableRowElement>('tbody tr[aria-selected]')!
async function doubleClickRow() { await act(async () => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))) }
async function ready() { await vi.waitFor(() => expect(row()?.tabIndex).toBe(0)) }
const reads = () => requests.filter(r => r.url?.endsWith('/finder'))

test('kit picker keeps its reference labels, kit unit and complete identity metadata', async () => {
  kind = 'kit'; await draw(); await ready()
  expect(document.body.textContent).toContain('价格 A 参考')
  expect(document.body.textContent).toContain('100.0000')
  expect(document.body.textContent).toContain('独立现货参考')
  expect(document.body.textContent).not.toContain('选择后按客户等级核对成交价')
  expect(document.body.textContent).not.toContain('按当前客户价格，辅助单位沿原换算')
  await doubleClickRow()
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({
    unit: '组', spec: '组合型号', color: '银色', articleNumber: 'SUP-K1', costPrice: 80,
    components: kit.version.components,
    input: expect.objectContaining({ priceSource: 'kit_default', kitVersionId: 7, warehouseId: 1 })
  }))
})

test.each(['hidden', 'paused'] as const)('%s picker initially sends no read and shows no dialog', async pause => {
  if (pause === 'hidden') active = false; else interactive = false
  await draw()
  expect(requests).toHaveLength(0)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(closed).not.toHaveBeenCalled()
})

test.each(['hidden', 'paused'] as const)('%s picker retains search while complete fresh reads resume', async pause => {
  await draw(); await ready(); await search('保留关键词'); await ready()
  expect(reads().at(-1)?.params).toMatchObject({ page: 1, keyword: '保留关键词', warehouseId: 1 })
  const count = requests.length
  if (pause === 'hidden') active = false; else interactive = false
  await draw()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(closed).not.toHaveBeenCalled()
  await draw(); expect(requests).toHaveLength(count)
  active = true; interactive = true; await draw(); await ready()
  expect(searchInput().value).toBe('保留关键词')
  expect(reads()).toHaveLength(3)
  expect(reads().at(-1)?.params).toMatchObject({ page: 1, keyword: '保留关键词', warehouseId: 1 })
  await doubleClickRow()
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({
    name: '当前商品', code: 'P41', unit: '个', baseUnit: '个', spec: 'M4', color: '银色',
    articleNumber: 'SUP-41', costPrice: 2, allowDecimalQty: false, units: product.units,
    input: expect.objectContaining({ kind: 'ordinary', productId: 41, entryUnit: '个', priceSource: 'default', warehouseId: 1 })
  }))
  expect(requests.every(r => r.baseURL === owner.baseURL && r._authSessionGeneration === owner.sessionGeneration && r._erpApiFallbackTried)).toBe(true)
})

test('hidden then restored picker rejects late detail selection and its loading cleanup cannot unlock a new selection', async () => {
  let detailNumber = 0
  respond = async config => {
    if (config.url !== '/products/41') return page([product])
    const number = ++detailNumber
    await new Promise<void>(resolve => { releases[number - 1] = resolve })
    return { ...product, spec: number === 1 ? '旧详情' : '新详情' }
  }
  await draw(); await ready(); await doubleClickRow()
  expect(detailNumber).toBe(1)
  active = false; await draw(); active = true; await draw(); await ready(); await doubleClickRow()
  expect(detailNumber).toBe(2)
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(selected).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
  expect(row().tabIndex).toBe(-1)
  await act(async () => { releases[1](); await Promise.resolve() })
  await vi.waitFor(() => expect(selected).toHaveBeenCalledTimes(1))
  expect(selected.mock.calls[0][0]).toMatchObject({ spec: '新详情' })
})

test('live pause rejects a detail arriving before the parent has rerendered', async () => {
  respond = async config => {
    if (config.url !== '/products/41') return page([product])
    await new Promise<void>(resolve => { releases[0] = resolve })
    return product
  }
  await draw(); await ready(); await doubleClickRow()
  interactive = false
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(selected).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
})

test('owner epoch change rejects an old detail and reads a fresh list without changing search', async () => {
  respond = async config => {
    if (config.url !== '/products/41') return page([product])
    await new Promise<void>(resolve => { releases[0] = resolve })
    return product
  }
  await draw(); await ready(); await search('原关键词'); await ready(); await doubleClickRow()
  epoch++; await draw(); await ready()
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(selected).not.toHaveBeenCalled(); expect(searchInput().value).toBe('原关键词')
  expect(row().tabIndex).toBe(0)
  expect(reads()).toHaveLength(3)
})


test('bounded batches replace visible pagination and virtual rows can reach the final record', async () => {
  const products = Array.from({ length: 230 }, (_, i) => ({ ...product, id: i + 1, code: `P${i + 1}`, name: `受控商品 ${i + 1}` }))
  respond = async config => page(products.slice((config.params.page - 1) * 100, config.params.page * 100), config.params.page, products.length)
  await draw(); await ready()
  expect(reads().map(r => r.params)).toEqual([1, 2, 3].map(page => expect.objectContaining({ page, pageSize: 100 })))
  expect(document.body.textContent).not.toContain('上一页')
  expect(document.body.textContent).not.toContain('下一页')
  expect(document.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  const scroll = document.querySelector<HTMLElement>('[data-table-scroll]')!
  await act(async () => { scroll.scrollTop = 230 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  expect(document.body.textContent).toContain('受控商品 230')
})

test('ordinary category search is sent to the server across the full query scope', async () => {
  enableCategories()
  respond = async config => config.url === '/categories/tree' ? categories : page([{ ...product, name: config.params.categoryId === 1 ? '远端分类商品' : '全部商品' }])
  await draw(); await ready(); await click('五金'); await ready(); await search('跨页关键词'); await ready()
  expect(reads().at(-1)?.params).toMatchObject({ categoryId: 1, keyword: '跨页关键词', page: 1, pageSize: 100 })
  expect(document.body.textContent).toContain('远端分类商品')
  expect(requests.every(r => r.baseURL === owner.baseURL && r._authSessionGeneration === owner.sessionGeneration && r._erpApiFallbackTried)).toBe(true)
})

test('kit classification queries the complete remote category including descendants beyond the initial batch', async () => {
  kind = 'kit'; enableCategories()
  const kits = Array.from({ length: 101 }, (_, i) => ({ ...kit, id: i + 1, code: `K${i + 1}`, name: i === 100 ? '后批子分类成套配件' : `其他成套 ${i + 1}`, categoryId: i === 100 ? 2 : 3 }))
  respond = async config => {
    if (config.url === '/categories/tree') return categories
    const matching = config.params.categoryId === 1 ? kits.filter(item => item.categoryId === 2) : kits
    return page(matching.slice((config.params.page - 1) * 100, config.params.page * 100), config.params.page, matching.length)
  }
  await draw(); await ready(); await click('五金'); await ready()
  expect(document.body.textContent).toContain('后批子分类成套配件')
  expect(document.body.textContent).not.toContain('其他成套 1')
  expect(reads()).toHaveLength(3)
  expect(reads().at(-1)?.params).toMatchObject({ categoryId: 1, keyword: '', page: 1, pageSize: 100 })
  expect(document.body.textContent).toContain('共 1 条')
})

test('an incomplete kit category result is explicit and cannot be confirmed', async () => {
  kind = 'kit'; enableCategories()
  respond = async config => {
    if (config.url === '/categories/tree') return categories
    const n = Number(config.params.page)
    return page(Array.from({ length: 100 }, (_, i) => ({ ...kit, id: (n - 1) * 100 + i + 1, categoryId: 2 })), n, 5100)
  }
  await draw(); await vi.waitFor(() => expect(reads()).toHaveLength(50)); await vi.waitFor(() => expect(document.body.textContent).toContain('5,000'))
  await click('五金')
  await vi.waitFor(() => expect(reads()).toHaveLength(100))
  await vi.waitFor(() => expect(document.body.textContent).toContain('缩小搜索范围'))
  expect(document.body.textContent).toContain('缩小搜索范围')
  expect(document.querySelectorAll('tbody tr:not([aria-hidden])')).toHaveLength(0)
  expect(button('确认选择').disabled).toBe(true)
  expect(selected).not.toHaveBeenCalled()
})

test('typing before query completion and repeated detail selection cannot confirm stale data', async () => {
  respond = async config => {
    if (config.url !== '/products/41') return page([product])
    await new Promise<void>(resolve => { releases[0] = resolve }); return product
  }
  await draw(); await ready()
  await act(async () => { row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  expect(requests.filter(r => r.url === '/products/41')).toHaveLength(1)
  await click('取消')
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(selected).not.toHaveBeenCalled(); expect(closed).toHaveBeenCalledTimes(1)
})

test('list errors are retryable and an empty query is shown as an empty state', async () => {
  respond = async () => { throw Error('受控读取失败') }
  await draw(); await vi.waitFor(() => expect(document.body.textContent).toContain('受控读取失败'))
  expect(button('重试')).toBeTruthy()
  respond = async () => page([])
  await click('重试'); await vi.waitFor(() => expect(document.body.textContent).toContain('没有匹配的商品'))
  expect(button('确认选择').disabled).toBe(true)
})

test('category permission is checked live and absent permission never reads the category tree', async () => {
  await draw(); await ready()
  expect(requests.some(r => r.url === '/categories/tree')).toBe(false)
  expect(document.body.textContent).toContain('当前没有分类查看权限')
})

test('canceling a pending first batch prevents every later batch', async () => {
  respond = async config => {
    await new Promise<void>(resolve => { releases[0] = resolve })
    return page([product], config.params.page, 200)
  }
  await draw()
  expect(reads()).toHaveLength(1)
  await click('取消')
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(reads()).toHaveLength(1); expect(selected).not.toHaveBeenCalled()
})

test('unsubmitted search and a pending fresh search disable every old row confirmation', async () => {
  await draw(); await ready()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(searchInput(), '新输入')
    searchInput().dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(row().tabIndex).toBe(-1)
  await act(async () => document.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(selected).not.toHaveBeenCalled(); expect(requests.filter(r => r.url === '/products/41')).toHaveLength(0)
})

test('a delayed category tree cannot expose categories after permission is revoked', async () => {
  enableCategories()
  respond = async config => {
    if (config.url !== '/categories/tree') return page([product])
    await new Promise<void>(resolve => { releases[0] = resolve }); return categories
  }
  await draw(); await ready()
  useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.PRODUCT_VIEW] } }))
  await draw()
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(button('五金')).toBeUndefined()
  expect(document.body.textContent).toContain('当前没有分类查看权限')
})

test('repeated kit double clicks deliver one selected line', async () => {
  kind = 'kit'; await draw(); await ready()
  await act(async () => { row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  expect(selected).toHaveBeenCalledTimes(1)
})


test.each(['ordinary', 'kit'] as const)('%s picker has only eight data columns and confirms by double click', async pickerKind => {
  kind = pickerKind; await draw(); await ready()
  const table = document.querySelector('table')!
  expect([...table.querySelectorAll('th')].map(cell => cell.textContent)).toEqual([
    '编码', '供应商型号', '型号', '商品名称', '颜色', '单位',
    pickerKind === 'kit' ? '独立现货参考' : '可用库存', '价格 A 参考'
  ])
  expect(table.querySelectorAll('col')).toHaveLength(8)
  expect(row().cells).toHaveLength(8)
  expect(row().cells[0].textContent).toBe(pickerKind === 'kit' ? kit.code : product.code)
  expect(table.querySelectorAll('button')).toHaveLength(0)
  expect(table.querySelector('[data-selection-column]')).toBeNull()
  expect(document.body.textContent).not.toContain('双击')
  expect(selected).not.toHaveBeenCalled()
  await doubleClickRow()
  await vi.waitFor(() => expect(selected).toHaveBeenCalledTimes(1))
})

test('row keyboard selection and footer confirmation work without a selection column', async () => {
  await draw(); await ready()
  await act(async () => row().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
  expect(row().getAttribute('aria-selected')).toBe('true')
  expect(button('确认选择').disabled).toBe(false)
  await click('确认选择')
  await vi.waitFor(() => expect(selected).toHaveBeenCalledTimes(1))
})

test('an unavailable kit cannot be chosen by double click or the footer', async () => {
  kind = 'kit'
  respond = async config => config.url === '/categories/tree' ? categories : page([{ ...kit, selectable: false, disabledReasons: [{ message: '版本已停用' }] }])
  await draw(); await vi.waitFor(() => expect(document.body.textContent).toContain('版本已停用'))
  expect(row().tabIndex).toBe(-1)
  await doubleClickRow()
  expect(selected).not.toHaveBeenCalled()
  expect(button('确认选择').disabled).toBe(true)
})
