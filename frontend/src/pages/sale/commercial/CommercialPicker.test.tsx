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
  version: { referenceUnitPrice: 100, salePriceB: 90 }, selectable: true,
  disabledReasons: [], standaloneCompleteSetsByCurrentStock: 2
}
let host: HTMLDivElement, root: Root, owner: ReturnType<typeof captureKitReadOwner>
let active: boolean, interactive: boolean, epoch: number, kind: 'kit' | 'ordinary'
const selected = vi.fn(), closed = vi.fn(), requests: InternalAxiosRequestConfig[] = []
const releases: (() => void)[] = []
let respond: (config: InternalAxiosRequestConfig) => Promise<unknown>

function page(list: unknown[]) { return { list, pagination: { total: 45, pageSize: 20, page: 1 } } }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear(); localStorage.clear(); setApiClientBaseURL('/original/api')
  useAuthStore.getState().login('offline-picker-fixture', null, {
    id: 9, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 2,
    permissions: [PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.PRODUCT_VIEW]
  })
  owner = captureKitReadOwner(); active = true; interactive = true; epoch = 1; kind = 'ordinary'
  requests.length = 0; releases.length = 0; selected.mockReset(); closed.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  respond = async config => config.url === '/products/41' ? product : page([config.url === '/kits/finder' ? kit : product])
  api.defaults.adapter = (async config => {
    requests.push(config)
    if (config.method !== 'get' || !['/products/finder', '/kits/finder', '/products/41'].includes(config.url!))
      throw Error(`禁止真实网络，未提供选择器响应 ${config.method} ${config.url}`)
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: await respond(config) } }
  }) satisfies AxiosAdapter
})
afterEach(async () => {
  await act(async () => { releases.forEach(release => release()); root.unmount() })
  host.remove(); document.body.innerHTML = ''; api.defaults.adapter = oldAdapter
  useAuthStore.setState({ token: null, user: null }); vi.restoreAllMocks()
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
async function ready() { await vi.waitFor(() => expect(button('选择')?.disabled).toBe(false)) }
const reads = () => requests.filter(r => r.url?.endsWith('/finder'))

test('kit picker keeps its reference labels, kit unit and complete identity metadata', async () => {
  kind = 'kit'; await draw(); await ready()
  expect(document.body.textContent).toContain('价格 A 参考：100.0000/组')
  expect(document.body.textContent).toContain('独立参考 2 组')
  expect(document.body.textContent).toContain('选择后按客户等级核对成交价')
  await click('选择')
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({
    unit: '组', spec: '组合型号', color: '银色', articleNumber: 'SUP-K1', costPrice: 80,
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

test.each(['hidden', 'paused'] as const)('%s picker retains the search and page while fresh reads resume', async pause => {
  await draw(); await ready(); await search('保留关键词'); await ready(); await click('下一页'); await ready()
  expect(reads().at(-1)?.params).toMatchObject({ page: 2, keyword: '保留关键词', warehouseId: 1 })
  const count = requests.length
  if (pause === 'hidden') active = false; else interactive = false
  await draw()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(closed).not.toHaveBeenCalled()
  await draw(); expect(requests).toHaveLength(count)
  active = true; interactive = true; await draw(); await ready()
  expect(searchInput().value).toBe('保留关键词')
  expect(reads()).toHaveLength(4)
  expect(reads().at(-1)?.params).toMatchObject({ page: 2, keyword: '保留关键词', warehouseId: 1 })
  await click('选择')
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
  await draw(); await ready(); await click('选择')
  expect(detailNumber).toBe(1)
  active = false; await draw(); active = true; await draw(); await ready(); await click('选择')
  expect(detailNumber).toBe(2)
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(selected).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
  expect(button('选择').disabled).toBe(true)
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
  await draw(); await ready(); await click('选择')
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
  await draw(); await ready(); await search('原关键词'); await ready(); await click('选择')
  epoch++; await draw(); await ready()
  await act(async () => { releases[0](); await Promise.resolve() })
  expect(selected).not.toHaveBeenCalled(); expect(searchInput().value).toBe('原关键词')
  expect(button('选择').disabled).toBe(false)
  expect(reads()).toHaveLength(3)
})
