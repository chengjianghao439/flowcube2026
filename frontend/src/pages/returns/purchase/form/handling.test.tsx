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
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
const original = client.defaults.adapter, unknown: string[] = [], calls: string[] = []
vi.mock('@/components/finder', async () => { const actual = await vi.importActual<typeof import('@/components/finder')>('@/components/finder'); return { ...actual, ProductFinder: () => null, CustomerFinder: () => null } })
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); unknown.length = 0; calls.length = 0; setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: Object.values(P) }); client.defaults.adapter = async c => { calls.push(c.url!); let data: unknown; if(c.method === 'get' && ['/warehouses/active','/carriers/active'].includes(c.url!)) data = []; else if(c.method === 'get' && ['/disposals','/disposals/handling-sources'].includes(c.url!)) data = { list: [], pagination: { page: 1, pageSize: 20, total: 0 } }; else { unknown.push(c.method+' '+c.url); throw Error('unexpected endpoint') }; return { config: c, status:200,statusText:'OK',headers:{},data:{success:true,data} } } })
afterEach(() => { client.defaults.adapter = original; localStorage.clear(); expect(unknown).toEqual([]) })
async function page(path: string, run: (host: HTMLElement, show: (active: boolean) => Promise<void>) => void | Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const show = async (active: boolean) => {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}><TabPathContext.Provider value={path}><Page /></TabPathContext.Provider></SectionVisibilityContext.Provider></QueryClientProvider></MemoryRouter>))
    await act(async () => { await new Promise(r => setTimeout(r, 15)) })
  }
  try { await show(true); await run(host, show) }
  finally { await act(async () => root.unmount()); qc.clear(); host.remove() }
}
import Page from './index'
test.each(['handlingSourceId=', 'handlingSourceId=11&handlingSourceId=11', 'handlingSourceId=11&sourceId=12'])('退货处理来源 %s 不降级无源退货', async q => { await page('/returns/purchase/new?'+q, host => { expect(host.textContent).toContain('处理来源参数无效'); expect(host.textContent).not.toContain('新建采购退货单') }) })

const source = { id:11,intentUuid:'11111111-1111-4111-8111-111111111111',productId:3,productCode:'P3',productName:'意图商品',warehouseId:8,warehouseName:'原仓',warehouseCode:'W8',unit:'个',handlingType:2,quantity:10,revision:1,originKind:'ordinary',budget:{intentionQuantity:10,allocatedQuantity:0,releasedQuantity:0,availableQuantity:6,actualExecutedQuantity:0,progress:'待关联'},links:[] }
const po = { id:31,orderNo:'PO31',supplierId:7,supplierName:'原供应商',warehouseId:8,warehouseName:'原仓',items:[101,102].map((id,index) => ({sourceItemId:id,productId:3,productCode:'P3',productName:'原采购商品',unit:'个',quantity:10,returnedQty:index,remainingQty:10-index,unitPrice:index?4.1234:3,amount:10*(index?4.1234:3)})) }
const posts: Array<{ data: unknown; baseURL: string | undefined }> = []
let resolvePo: null | (() => void) = null
function actualAdapter(delayed = false) {
  const fallback = client.defaults.adapter
  if(typeof fallback !== 'function') throw Error('fixture needs exact adapter')
  client.defaults.adapter = async c => {
    if(c.method === 'get' && c.url === '/disposals/handling-sources/11') return reply(c,source)
    if(c.method === 'get' && c.url === '/products/3') return reply(c,{id:3,code:'P3',name:'当前商品',unit:'个',isActive:true,allowDecimalQty:true})
    if(c.method === 'get' && c.url === '/warehouses/active') return reply(c,[{id:8,name:'原仓'}])
    if(c.method === 'get' && c.url === '/products/qty-policies' && c.params.ids === '3') return reply(c,[{id:3,allowDecimal:true}])
    if(c.method === 'get' && c.url === '/returns/purchase/source-order' && c.params.orderNo === 'PO31') {
      if(delayed) await new Promise<void>(r => { resolvePo=r })
      return reply(c,po)
    }
    if(c.method === 'post' && c.url === '/returns/purchase') { posts.push({data:JSON.parse(c.data),baseURL:c.baseURL}); return reply(c,{id:51,returnNo:'PR51'}) }
    return fallback(c)
  }
}
function reply(c: import('axios').InternalAxiosRequestConfig,data:unknown) { return {config:c,status:200,statusText:'OK',headers:{},data:{success:true,data}} }
async function click(text: string) { const b=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim() === text || b.textContent?.startsWith(text)); expect(b,text).toBeTruthy(); await act(async()=>b!.click()); await act(async()=>{await new Promise(r=>setTimeout(r,10))}) }
async function input(el:HTMLInputElement,value:string) { await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}) }
test('真实PR加载完整原PO但重复SKU不自动选；员工第2行精确sourceItemId/原价/基本量创建',async()=>{
  posts.length=0;actualAdapter()
  await page('/returns/purchase/new?handlingSourceId=11',async host=>{
    await input(host.querySelector<HTMLInputElement>('input[placeholder="输入原单号"]')!,'PO31');await click('载入')
    expect(host.querySelector('input[placeholder="数量"]')).toBeNull()
    expect(host.textContent).toContain('同商品多行须明确选择')
    await click('选择原采购第 2 行')
    const quantity=host.querySelector<HTMLInputElement>('input[placeholder="数量"]')!;expect(quantity.disabled).toBe(false);expect(quantity.value).toBe('0')
    expect(host.querySelector<HTMLInputElement>('input[placeholder="单价"]')!.value).toBe('4.1234');expect(host.querySelector<HTMLInputElement>('input[placeholder="单价"]')!.disabled).toBe(true)
    await input(quantity,'2.5');await click('创建退货单')
    expect(posts).toHaveLength(1);expect(posts[0].baseURL).toBe('/a')
    expect(posts[0].data).toMatchObject({supplierId:7,warehouseId:8,purchaseOrderId:31,items:[{sourceItemId:102,productId:3,unit:'个',quantity:2.5,unitPrice:4.1234}],disposalSource:{sourceId:11,expectedRevision:1}})
    expect(host.textContent).not.toContain('添加商品')
  })
})
test('来源模式不能清PO降手工/换仓/第2SKU，数量超sourcefree不POST',async()=>{
  posts.length=0;actualAdapter()
  await page('/returns/purchase/new?handlingSourceId=11',async host=>{
    await input(host.querySelector<HTMLInputElement>('input[placeholder="输入原单号"]')!,'PO31');await click('载入');await click('选择原采购第 1 行')
    expect([...host.querySelectorAll('button')].find(b=>b.textContent==='清除')!.disabled).toBe(true)
    expect(host.querySelector('input[placeholder="输入原单号"]')!.hasAttribute('disabled')).toBe(true)
    await input(host.querySelector<HTMLInputElement>('input[placeholder="数量"]')!,'7');await click('创建退货单');expect(posts).toEqual([])
  })
})
test('慢PO在serverABA后不覆盖原单号、不显示旧供应商/选择行、不另读或POST',async()=>{
  posts.length=0;actualAdapter(true)
  await page('/returns/purchase/new?handlingSourceId=11',async host=>{
    await input(host.querySelector<HTMLInputElement>('input[placeholder="输入原单号"]')!,'PO31');await click('载入');expect(resolvePo).toBeTruthy()
    await act(async()=>{setApiClientBaseURL('/b');setApiClientBaseURL('/a');resolvePo!()});await act(async()=>{await new Promise(r=>setTimeout(r,10))})
    expect(host.querySelector<HTMLInputElement>('input[placeholder="输入原单号"]')!.value).toBe('PO31');expect(host.textContent).not.toContain('原供应商');expect(host.querySelector('input[placeholder="数量"]')).toBeNull();expect(posts).toEqual([])
  })
})

import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
test('真实PR成功后的列表刷新晚返回跨server ABA，不关闭原来源草稿或导航旧ACK', async () => {
  const path = '/returns/purchase/new?handlingSourceId=11', registration = buildWorkspaceTabRegistrationFromPath(path)
  useWorkspaceStore.setState({ tabs: [HOME_TAB, { ...registration, title: '来源退货草稿', closable: true }], activeKey: registration.key })
  const resolves: Array<() => void> = []
  const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockImplementation(filters =>
    filters?.queryKey?.[0] === 'returns' ? new Promise<void>(r => resolves.push(r)) : Promise.resolve())
  posts.length = 0; actualAdapter()
  try {
    await page(path, async host => {
      await input(host.querySelector<HTMLInputElement>('[placeholder="输入原单号"]')!, 'PO31')
      await click('载入'); await click('选择原采购第 1 行')
      await input(host.querySelector<HTMLInputElement>('[placeholder="数量"]')!, '2')
      await click('创建退货单'); expect(posts).toHaveLength(1); expect(resolves.length).toBeGreaterThan(0)
      await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); resolves.forEach(r => r()) })
      expect(useWorkspaceStore.getState().tabs.some(t => t.key === registration.key)).toBe(true)
      expect(useWorkspaceStore.getState().tabs.some(t => t.path === '/returns/purchase/51')).toBe(false)
    })
  } finally { invalidate.mockRestore(); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }) }
})


test.each(['success', 'error'])('真实PO%s隐藏恢复后旧响应不回填，当前可主动重读原单', async outcome => {
  posts.length = 0; actualAdapter()
  const fallback = client.defaults.adapter
  if (typeof fallback !== 'function') throw Error('exact adapter required')
  let settle!: () => void, settleCurrent!: () => void, reads = 0
  client.defaults.adapter = async c => {
    if (c.method === 'get' && c.url === '/returns/purchase/source-order' && c.params.orderNo === 'PO31') {
      const read = ++reads
      if (read === 1) await new Promise<void>((resolve, reject) => { settle = () => outcome === 'error' ? reject(Error('旧活动PO失败')) : resolve() })
      if (read === 2) await new Promise<void>(resolve => { settleCurrent = resolve })
    }
    return fallback(c)
  }
  await page('/returns/purchase/new?handlingSourceId=11', async (host, show) => {
    await input(host.querySelector<HTMLInputElement>('input[placeholder="输入原单号"]')!, 'PO31')
    await click('载入'); expect(settle).toBeTruthy()
    await show(false); await show(true)
    const load = [...host.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith('载入'))!
    expect(load).toBeTruthy()
    expect(load.disabled).toBe(false)
    await click('载入'); expect(settleCurrent).toBeTruthy()
    await act(async () => settle()); await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(host.textContent).not.toContain('原供应商')
    expect(host.textContent).not.toContain('旧活动PO失败')
    expect(host.querySelector<HTMLInputElement>('input[placeholder="输入原单号"]')!.value).toBe('PO31')
    expect(host.querySelector('input[placeholder="数量"]')).toBeNull()
    expect(load.disabled).toBe(true)
    await act(async () => settleCurrent()); await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(host.textContent).toContain('原供应商'); expect(reads).toBe(2); expect(posts).toEqual([])
  })
})
