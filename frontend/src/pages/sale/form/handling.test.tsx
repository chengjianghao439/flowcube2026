// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import client, { setApiClientBaseURL } from '@/api/client'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { useAuthStore } from '@/store/authStore'
import { TabPathContext } from '@/components/layout/TabPathContext'
const original = client.defaults.adapter, unknown: string[] = [], calls: string[] = []
const finder = vi.hoisted(() => ({ confirm: null as null | ((r: { id: number; name: string; code: string }) => void) }))
vi.mock('@/components/finder', () => ({ SupplierFinder: () => null, ProductFinder: () => null, CustomerFinder: (p: { open: boolean; onConfirm: (r: { id: number; name: string; code: string }) => void }) => { finder.confirm = p.onConfirm; return p.open ? <button onClick={() => p.onConfirm({ id: 4, name: '当前客户', code: 'C4' })}>选择夹具客户</button> : null } }))
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); unknown.length = 0; calls.length = 0; setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: Object.values(P) }); client.defaults.adapter = async c => { calls.push(c.url!); let data: unknown; if(c.method === 'get' && ['/warehouses/active','/carriers/active'].includes(c.url!)) data = []; else if(c.method === 'get' && ['/disposals','/disposals/handling-sources'].includes(c.url!)) data = { list: [], pagination: { page: 1, pageSize: 20, total: 0 } }; else { unknown.push(c.method+' '+c.url); throw Error('unexpected endpoint') }; return { config: c, status:200,statusText:'OK',headers:{},data:{success:true,data} } } })
afterEach(() => { client.defaults.adapter = original; localStorage.clear(); expect(unknown).toEqual([]) })
async function page(path: string, run: (host: HTMLElement, show: (active: boolean) => Promise<void>) => void | Promise<void>, Leaf = Page) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const show = async (active: boolean) => {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}><TabPathContext.Provider value={path}><Leaf /></TabPathContext.Provider></SectionVisibilityContext.Provider></QueryClientProvider></MemoryRouter>))
    await act(async () => { await new Promise(r => setTimeout(r, 15)) })
  }
  try { await show(true); await run(host, show) }
  finally { await act(async () => root.unmount()); qc.clear(); host.remove() }
}
import Page from './index'
import SaleReturnFormPage from '@/pages/returns/sale/form'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
test.each(['handlingSourceId=', 'handlingSourceId=11&handlingSourceId=11', 'handlingSourceId=11&sourceId=12'])('销售处理来源 %s 拒绝且保原参数，不挂空白草稿', async q => { await page('/sale/new?'+q, host => { expect(host.textContent).toContain('处理来源参数无效'); expect(host.textContent).not.toContain('新建销售单') }) })

test('真实销售退货页在挂普通表单前拒绝处理来源，不查询业务数据', async () => {
  const registration = buildWorkspaceTabRegistrationFromPath('/returns/sale/new?handlingSourceId=11')
  await page(registration.path, host => {
    expect(host.querySelector('[role="alert"]')?.textContent ?? '').toContain('处理来源参数无效')
    expect(host.textContent).not.toContain('新建销售退货单')
    expect(calls).toEqual([])
  }, SaleReturnFormPage)
})

test.each(['sourceNo=', 'sourceType=', 'sourceNo=&sourceNo=', 'sourceType=&sourceType='])('registered销售处理来源保留混用%s并由真实页拒绝', async extra => {
  actualAdapter()
  const registration = buildWorkspaceTabRegistrationFromPath('/sale/new?handlingSourceId=11&' + extra)
  await page(registration.path, host => {
    expect(host.querySelector('[role="alert"]')?.textContent ?? '').toContain('处理来源参数无效')
    expect(host.textContent).not.toContain('载入来源商品')
  })
  const params = new URLSearchParams(registration.path.split('?')[1])
  const original = new URLSearchParams(extra)
  for (const key of ['sourceNo', 'sourceType']) expect(params.getAll(key)).toEqual(original.getAll(key))
  expect(registration.key).not.toBe(buildWorkspaceTabRegistrationFromPath('/sale/new?handlingSourceId=11').key)
})

const source = { id: 11, intentUuid: '11111111-1111-4111-8111-111111111111', productId: 3, productCode: 'P3', productName: '意图商品', warehouseId: 8, warehouseName: '原仓', warehouseCode: 'W8', unit: '个', handlingType: 1, quantity: 10, revision: 1, originKind: 'ordinary', budget: { intentionQuantity: 10, allocatedQuantity: 0, releasedQuantity: 0, availableQuantity: 10, actualExecutedQuantity: 0, progress: '待关联' }, links: [] }
const requests: Array<{ url: string; method: string; data: unknown; baseURL: string | undefined }> = []
function actualAdapter() {
  const fallback = client.defaults.adapter
  if (typeof fallback !== 'function') throw Error('exact adapter required')
  client.defaults.adapter = async c => {
    if (c.method === 'get' && c.url === '/disposals/handling-sources/11') return reply(c, source)
    if (c.method === 'get' && c.url === '/products/3') return reply(c, { id: 3, name: '当前商品', code: 'P3', unit: '个', isActive: true, salePrice: 5, allowDecimalQty: true, units: [{ unitName: '个', isBase: true, conversionRate: 1 }, { unitName: '箱', isBase: false, conversionRate: 6 }] })
    if (c.method === 'get' && c.url === '/warehouses/active') return reply(c, [{ id: 8, name: '原仓' }])
    if (c.method === 'get' && c.url === '/products/qty-policies' && c.params.ids === '3') return reply(c, [{ id: 3, allowDecimal: true }])
    if (c.method === 'get' && c.url === '/price-lists/customer-price' && c.params.customerId === 4 && c.params.productId === 3) return reply(c, { salePrice: 7.1234, priceLevel: 'B', priceLevelName: '当前B价', source: 'price_level' })
    if (c.method === 'post' && c.url === '/sale') { requests.push({ url: c.url, method: c.method, data: JSON.parse(c.data), baseURL: c.baseURL }); return reply(c, { id: 91, orderNo: 'SO91' }) }
    return fallback(c)
  }
}
function reply(c: import('axios').InternalAxiosRequestConfig, data: unknown) { return { config:c,status:200,statusText:'OK',headers:{},data:{success:true,data} } }
async function click(label: string) { const b = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label); expect(b,label).toBeTruthy(); await act(async () => b!.click()); await act(async () => { await new Promise(r => setTimeout(r,10)) }) }
async function input(el: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})) }) }
test('真实普通新建仅初始化来源SKU/基本单位/原仓；客户主动选当前报价，POST原API准确source', async () => {
  requests.length = 0; actualAdapter()
  await page('/sale/new?handlingSourceId=11', async host => {
    await click('载入来源商品')
    expect(host.textContent).toContain('原仓'); expect([...host.querySelectorAll('button')].some(b => b.textContent?.trim() === '添加商品')).toBe(false)
    expect(host.querySelector<HTMLInputElement>('input[aria-label="当前商品数量"]')!.value).toBe('0')
    expect(host.querySelector('select[title="录入单位"]')).toBeNull()
    expect(calls).not.toContain('/price-lists/customer-price')
    await act(async () => host.querySelector<HTMLElement>('[data-entry-field="party"] button')!.click())
    await click('选择夹具客户'); await input(host.querySelector<HTMLInputElement>('input[aria-label="当前商品数量"]')!, '2.5')
    await click('保存草稿')
    expect(requests).toHaveLength(1)
    expect(requests[0].baseURL).toBe('/a')
    expect(requests[0].data).toMatchObject({ customerId:4, warehouseId:8, items:[{productId:3,unit:'个',entryUnit:'个',quantity:2.5,unitPrice:7.1234}], disposalSource:{sourceId:11,expectedRevision:1} })
  })
})
test('已有备注不能被商品来源初始化覆盖；原输入保留', async () => {
  actualAdapter()
  await page('/sale/new?handlingSourceId=11', async host => {
    const remark = host.querySelector<HTMLInputElement>('input[maxlength="50"]')!
    await input(remark,'员工已有备注'); await click('载入来源商品')
    expect(remark.value).toBe('员工已有备注'); expect(host.querySelector('[aria-label="当前商品数量"]')).toBeNull()
  })
})
test('来源Finder旧确认在服务器ABA/撤权后不得选客户或读报价，原商品数量保留', async () => {
  actualAdapter()
  await page('/sale/new?handlingSourceId=11', async host => {
    await click('载入来源商品'); const old = finder.confirm!
    await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); old({id:4,name:'旧客户',code:'C4'}) })
    expect(calls).not.toContain('/price-lists/customer-price'); expect(host.textContent).not.toContain('旧客户')
    expect(host.querySelector<HTMLInputElement>('[aria-label="当前商品数量"]')!.value).toBe('0')
  })
})

import { CustomerFinder as ActualCustomerFinder } from '@/components/finder/CustomerFinder'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { captureHandlingOwner, handlingOwnerCurrent } from '@/lib/disposalHandlingRecovery'
test('真实H6客户Finder隐藏时取消自动取齐续批、重显保关键词并重新读取', async () => {
  const owner = captureHandlingOwner(), requests: import('axios').InternalAxiosRequestConfig[] = []
  let resolveFirst!: () => void, active = true, first = true
  client.defaults.adapter = async c => {
    requests.push(c)
    if (c.method !== 'get' || c.url !== '/customers') { unknown.push(c.method + ' ' + c.url); throw Error('only actual customer list') }
    if (first) { first = false; await new Promise<void>(r => { resolveFirst = r }) }
    const page = c.params.page ?? 1
    return reply(c, { list: Array.from({ length: page === 1 ? 200 : 1 }, (_, i) => ({ id: (page - 1) * 200 + i + 1, name: '当前客户', code: 'C' + i, isActive: true })), pagination: { page, pageSize: 200, total: 201 } })
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const draw = () => act(async () => root.render(<QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}><ActualCustomerFinder open readOwner={owner} readGuard={{ epoch: owner.epoch, isCurrent: () => active && handlingOwnerCurrent(owner) }} onClose={() => {}} onConfirm={() => {}} /></SectionVisibilityContext.Provider></QueryClientProvider>))
  try {
    await draw(); expect(resolveFirst).toBeTruthy()
    await input(document.querySelector<HTMLInputElement>('[placeholder="搜索客户名称、编码…"]')!, '员工关键词')
    active = false; await draw(); await act(async () => resolveFirst()); await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(requests).toHaveLength(1)
    active = true; await draw(); await act(async () => { await new Promise(r => setTimeout(r, 350)) })
    expect(document.querySelector<HTMLInputElement>('[placeholder="搜索客户名称、编码…"]')!.value).toBe('员工关键词')
    expect(requests.slice(1).some(c => c.params.page === 2)).toBe(true)
    expect(requests.every(c => c.baseURL === '/a')).toBe(true)
  } finally { await act(async () => root.unmount()); qc.clear(); host.remove() }
})


test.each(['success', 'error'])('真实H6报价%s隐藏恢复后原响应不复活，原量保留且当前可重新报价', async outcome => {
  actualAdapter()
  const fallback = client.defaults.adapter
  if (typeof fallback !== 'function') throw Error('exact adapter required')
  let settle!: () => void, quotes = 0
  client.defaults.adapter = async c => {
    if (c.method === 'get' && c.url === '/price-lists/customer-price' && c.params.customerId === 4 && c.params.productId === 3) {
      quotes++
      if (quotes === 1) {
        await new Promise<void>((resolve, reject) => { settle = () => outcome === 'error' ? reject(Error('旧活动报价失败')) : resolve() })
        return reply(c, { salePrice: 99, priceLevel: 'OLD', source: 'price_level' })
      }
    }
    return fallback(c)
  }
  await page('/sale/new?handlingSourceId=11', async (host, show) => {
    await click('载入来源商品')
    await input(host.querySelector<HTMLInputElement>('[aria-label="当前商品数量"]')!, '2.5')
    await act(async () => host.querySelector<HTMLElement>('[data-entry-field="party"] button')!.click())
    await click('选择夹具客户'); expect(settle).toBeTruthy()
    await show(false); await show(true)
    await act(async () => settle()); await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(host.querySelector<HTMLInputElement>('[aria-label="当前商品单价"]')!.value).toBe('5')
    expect(host.querySelector<HTMLInputElement>('[aria-label="当前商品数量"]')!.value).toBe('2.5')
    expect(host.textContent).not.toContain('价格查询失败')
    await click('选择夹具客户')
    expect(host.querySelector<HTMLInputElement>('[aria-label="当前商品单价"]')!.value).toBe('7.1234')
    expect(quotes).toBe(2)
  })
})
