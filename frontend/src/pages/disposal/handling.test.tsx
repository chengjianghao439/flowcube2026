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
const finder = vi.hoisted(() => ({ confirm: null as null | ((p: { id: number; code: string; name: string; unit: string }) => void) }))
vi.mock('@/components/finder', () => ({ SupplierFinder: () => null, CustomerFinder: () => null, ProductFinder: (p: { open: boolean; onConfirm: (r: { id: number; code: string; name: string; unit: string }) => void }) => { finder.confirm = p.onConfirm; return p.open ? <button onClick={() => p.onConfirm({ id:3,code:'P3',name:'当前商品',unit:'个' })}>选择夹具商品</button> : null } }))
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); unknown.length = 0; calls.length = 0; setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: Object.values(P) }); client.defaults.adapter = async c => { calls.push(c.url!); let data: unknown; if(c.method === 'get' && ['/warehouses/active','/carriers/active'].includes(c.url!)) data = []; else if(c.method === 'get' && ['/disposals','/disposals/handling-sources'].includes(c.url!)) data = { list: [], pagination: { page: 1, pageSize: 20, total: 0 } }; else { unknown.push(c.method+' '+c.url); throw Error('unexpected endpoint') }; return { config: c, status:200,statusText:'OK',headers:{},data:{success:true,data} } } })
afterEach(() => { client.defaults.adapter = original; localStorage.clear(); expect(unknown).toEqual([]) })
async function page(path: string, run: (host: HTMLElement) => void | Promise<void>) { const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); try { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={qc}><TabPathContext.Provider value={path}><Page /></TabPathContext.Provider></QueryClientProvider></MemoryRouter>)); await act(async () => { await new Promise(r => setTimeout(r, 15)) }); await run(host) } finally { await act(async () => root.unmount()); qc.clear(); host.remove() } }
import Page from './index'
import HandlingScrapPage from './HandlingScrapPage'
import RecoveryPage from './DisposalRecoveryPage'
import { saveHandlingRecord, readHandlingRecords, type HandlingRecord } from '@/lib/disposalHandlingRecovery'
import { openHandlingTab } from './HandlingSourcesPanel'
import { MAX_WORKSPACE_TABS, HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
test('真实处置页有独立处理意图入口与来源分页，不取目标或自行执行', async () => { await page('/disposals', host => { expect(host.textContent).toContain('保存处理意图'); expect(host.textContent).toContain('处理来源'); expect(calls).toContain('/disposals/handling-sources') }) })

const intentUuid='11111111-1111-4111-8111-111111111111'
const source={id:11,intentUuid,productId:3,productCode:'P3',productName:'意图商品',warehouseId:8,warehouseName:'原仓',warehouseCode:'W8',unit:'个',handlingType:1,quantity:10,revision:1,originKind:'ordinary',budget:{intentionQuantity:10,allocatedQuantity:6,releasedQuantity:4,availableQuantity:8,actualExecutedQuantity:2,progress:'部分执行'},links:[{linkId:7,state:'TERMINATED',allocatedQuantity:6,releasedQuantity:0,executedQuantity:6,terminal:true,returnClosed:true,pendingReason:null}]}
const product={id:3,code:'P3',name:'当前商品',unit:'个',isActive:true,allowDecimalQty:true,costPrice:2}
const snapshot={version:1,head:{id:19,disposal_no:'DP19',warehouse_id:8,warehouse_name:'历史仓',status:3,total_value:'15.1234',remark:'历史备注',operator_id:2,operator_name:'历史制单人',approved_by:6,approved_by_name:'历史批准人',approved_at:'2026-10-04T04:00:00.000Z',reject_reason:null,disposed_at:null,created_at:'2026-10-04T03:00:00.000Z',updated_at:'2026-10-04T04:00:00.000Z',deleted_at:null,disposal_handling_link_id:null},items:[1,2,3].map(type=>({id:20+type,disposal_id:19,product_id:3,product_code:'OLD'+type,product_name:'历史商品'+type,unit:'历史单位',quantity:'2.00',unit_value:'3.1234',dispose_type:type,remark:'历史行'+type,created_at:'2026-10-04T03:00:00.000Z'})),approval:{approved_by:6,approved_by_name:'历史批准人',approved_at:'2026-10-04T04:00:00.000Z'}}
const posts: Array<{path:string;body:Record<string,unknown>;baseURL:string|undefined}> = []
const configs: import('axios').InternalAxiosRequestConfig[]=[]
function reply(c:import('axios').InternalAxiosRequestConfig,data:unknown){return{config:c,status:200,statusText:'OK',headers:{},data:{success:true,data}}}
function actualAdapter(options:{page2?:boolean;history?:boolean;scrap?:boolean;release?:boolean;signError?:boolean;historical?:typeof snapshot}={}){
 const fallback=client.defaults.adapter;if(typeof fallback!=='function')throw Error('exact adapter required')
 client.defaults.adapter=async c=>{
  configs.push(c)
  if(c.method==='get'&&c.url==='/warehouses/active')return reply(c,[{id:8,name:'原仓'}])
  if(c.method==='get'&&c.url==='/products/3')return reply(c,product)
  if(c.method==='get'&&c.url==='/products/qty-policies'&&c.params.ids==='3')return reply(c,[{id:3,allowDecimal:true}])
  if(c.method==='get'&&c.url==='/disposals/handling-sources')return reply(c,{list:[{...source,id:c.params.page===2?12:11,links:options.release?[{...source.links[0],state:'ACTIVE',executedQuantity:2,releasedQuantity:0}]:source.links}],pagination:{page:c.params.page,pageSize:20,total:options.page2?21:1}})
  if(c.method==='get'&&c.url==='/disposals/handling-sources/11')return reply(c,{...source,handlingType:options.scrap?3:1})
  if(c.method==='get'&&c.url==='/disposals')return reply(c,{list:options.history?[{id:19,disposalNo:'DP19',status:3,statusName:'已批准',warehouseName:'历史仓',totalValue:15.1234,operatorName:'历史制单人',createdAt:'2026-10-04 12:00:00'}]:[],pagination:{page:1,pageSize:20,total:options.history?1:0}})
  if(c.method==='get'&&c.url==='/disposals/19/conversion-snapshot')return reply(c,{snapshot:options.historical??snapshot,snapshotFingerprint:'a'.repeat(64),conversion:null})
  if(c.method==='post'&&['/disposals/handling-sources','/disposals','/disposals/19/sign-conversion','/disposals/handling-sources/11/links/7/release'].includes(c.url!)){
   const body=JSON.parse(c.data);posts.push({path:c.url!,body,baseURL:c.baseURL})
   if(c.url==='/disposals/handling-sources')return reply(c,{id:33,intentUuid:body.intentUuid,productId:body.productId,warehouseId:body.warehouseId,unit:body.unit,handlingType:body.handlingType,quantity:body.quantity,revision:1})
   if(c.url==='/disposals')return reply(c,{id:34,disposalNo:'DP34'})
   if(c.url?.includes('/release'))return reply(c,{sourceId:11,linkId:7,executedQuantity:2,releasedQuantity:4,revision:2})
   if(options.signError)throw Error('snapshot drift, keep original preview')
   return reply(c,{id:44,originalDisposalId:19,disposalNo:'DP19',operationUuid:body.operationUuid,snapshotFingerprint:body.snapshotFingerprint,sources:snapshot.items.map(i=>({sourceId:i.id+100,intentUuid:`00000000-0000-4000-8000-${String(i.id).padStart(12,'0')}`,legacyItemId:i.id,handlingType:i.dispose_type,productId:3,warehouseId:8,unit:i.unit,quantity:2,revision:1}))})
  }
  return fallback(c)
 }
}
async function click(label:string){const b=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);expect(b,label).toBeTruthy();await act(async()=>b!.click());await act(async()=>{await new Promise(r=>setTimeout(r,10))})}
async function input(el:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})}
async function leaf(Leaf:typeof Page,path:string,run:(host:HTMLElement)=>Promise<void>){const host=document.createElement('div');document.body.append(host);const root=createRoot(host),qc=new QueryClient({defaultOptions:{queries:{retry:false}}});try{await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={qc}><TabPathContext.Provider value={path}><Leaf/></TabPathContext.Provider></QueryClientProvider></MemoryRouter>));await act(async()=>{await new Promise(r=>setTimeout(r,15))});await run(host)}finally{await act(async()=>root.unmount());qc.clear();host.remove()}}
test.each(['sourceNo=', 'sourceType=', 'sourceNo=&sourceNo=', 'sourceType=&sourceType='])('registered来源报废保留混用%s并由真实页拒绝', async extra => {
  actualAdapter({ scrap: true })
  const registration = buildWorkspaceTabRegistrationFromPath('/disposals/new?handlingSourceId=11&' + extra)
  await leaf(HandlingScrapPage, registration.path, async host => {
    expect(host.querySelector('[role="alert"]')?.textContent ?? '').toContain('处理来源参数无效')
    expect(host.textContent).not.toContain('来源报废草稿')
  })
  const params = new URLSearchParams(registration.path.split('?')[1])
  const original = new URLSearchParams(extra)
  for (const key of ['sourceNo', 'sourceType']) expect(params.getAll(key)).toEqual(original.getAll(key))
  expect(registration.key).not.toBe(buildWorkspaceTabRegistrationFromPath('/disposals/new?handlingSourceId=11').key)
})
test('真实来源页服务端Q/A/E/R与第二页；TERMINATED R0也不解除，无VIEWmeta不造链接',async()=>{
 posts.length=0;configs.length=0;actualAdapter({page2:true})
 await page('/disposals',async host=>{
  expect(host.textContent).toContain('部分执行');expect(host.textContent).toContain('可关联 8 个');expect(host.querySelector('a[href*="sale"]')).toBeNull()
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='核对解除')!.disabled).toBe(true)
  await click('下一页');expect(host.textContent).toContain('第 2 / 2 页')
  expect(configs.filter(c=>c.url==='/disposals/handling-sources').map(c=>[c.params.page,c.listMode])).toEqual([[1,'paged'],[2,'paged']]);expect(posts).toEqual([])
 })
})
test('实际意图商品Finder+员工基本量保存完整body，不把库存参考量当意图',async()=>{
 posts.length=0;actualAdapter()
 await page('/disposals',async()=>{
  await click('保存处理意图');await click('选择意图商品');await click('选择夹具商品')
  const select=document.querySelector<HTMLSelectElement>('select[aria-label="处理仓库"]')!;await act(async()=>{select.value='8';select.dispatchEvent(new Event('change',{bubbles:true}))})
  await input(document.querySelector<HTMLInputElement>('input[aria-label="意图基本量"]')!,'1.5')
  const save=[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==='保存处理意图')!;await act(async()=>save.dispatchEvent(new MouseEvent('click',{bubbles:true})))
  expect(posts).toHaveLength(1);expect(posts[0].body).toMatchObject({productId:3,warehouseId:8,unit:'个',handlingType:1,quantity:1.5});expect(posts[0].body).not.toHaveProperty('totalQty')
 })
})
test('完整mixed旧单签认展示所有历史行与批准；漂移保原preview/fingerprint、不执行报废',async()=>{
 posts.length=0;actualAdapter({history:true,signError:true})
 await page('/disposals',async()=>{
  await click('整单签认');expect(document.body.textContent).toContain('历史商品1');expect(document.body.textContent).toContain('历史商品2');expect(document.body.textContent).toContain('历史商品3');expect(document.body.textContent).toContain('历史批准人');expect(document.body.textContent).toContain('3.1234')
  await input(document.querySelector<HTMLInputElement>('input[aria-label="签认说明"]')!,'全旧行核对');await click('确认整单签认')
  expect(posts).toHaveLength(1);expect(posts[0].path).toBe('/disposals/19/sign-conversion');expect(posts[0].body).toMatchObject({reason:'全旧行核对',snapshotFingerprint:'a'.repeat(64)})
  expect(document.body.textContent).toContain('历史商品3');expect(posts.some(p=>p.path.includes('/dispose'))).toBe(false)
 })
})
test('来源报废实际原CreateDisposalDialog仅原商品/仓，员工量创建新草稿而非旧批准执行',async()=>{
 posts.length=0;actualAdapter({scrap:true})
 await leaf(HandlingScrapPage,'/disposals/new?handlingSourceId=11',async()=>{
  await click('载入来源商品');const quantity=document.querySelector<HTMLInputElement>('input[title*="原参考量"]')!;await input(quantity,'2')
  await click('创建报废草稿');expect(posts).toHaveLength(1);expect(posts[0].path).toBe('/disposals');expect(posts[0].body).toMatchObject({warehouseId:8,items:[{productId:3,quantity:2,disposeType:3}],disposalSource:{sourceId:11,expectedRevision:1}})
  expect(posts.some(p=>p.path.includes('/dispose'))).toBe(false)
 })
})
test('同handling标签只focus原query草稿；满30拒新来源、不LRU',()=>{
 const path='/sale/new?handlingSourceId=11',old={...buildWorkspaceTabRegistrationFromPath(path),title:'处理草稿',path:path+'&keep=original',closable:true}
 useWorkspaceStore.setState({tabs:[HOME_TAB,old],activeKey:HOME_TAB.key});let opened='';expect(openHandlingTab(path,p=>{opened=p})).toBe(true);expect(opened).toBe(old.path)
 const full=Array.from({length:MAX_WORKSPACE_TABS},(_,i)=>({...old,key:'/sale/'+(i+1),path:'/sale/'+(i+1)}));useWorkspaceStore.setState({tabs:full,activeKey:full[0].key});expect(openHandlingTab('/sale/new?handlingSourceId=12',()=>{})).toBe(false);expect(useWorkspaceStore.getState().tabs).toEqual(full)
})


test.each(['pure-scrap','executed'])('完整预览%s已不符合旧签认资格，保原快照但禁POST', async kind => {
  posts.length = 0
  actualAdapter({ history: true, historical: kind === 'executed'
    ? { ...snapshot, head: { ...snapshot.head, status: 4 } }
    : { ...snapshot, items: snapshot.items.map(row => ({ ...row, dispose_type: 3 })) } })
  await page('/disposals', async () => {
    await click('整单签认')
    await input(document.querySelector<HTMLInputElement>('[aria-label="签认说明"]')!, '已核对原单')
    const confirm = [...document.querySelectorAll('button')].find(b => b.textContent === '确认整单签认')!
    expect(confirm.disabled).toBe(true)
    expect(document.body.textContent).toContain('原流程或人工核对')
    await act(async () => confirm.click())
    expect(posts).toEqual([])
    expect(document.body.textContent).toContain('历史商品3')
  })
})

function recoveryRecord(kind: 'source' | 'conversion'): HandlingRecord {
  const operationUuid = '22222222-2222-4222-8222-222222222222'
  return {
    version: 1, userId: 9, baseURL: '/a', method: 'post', createdAt: Date.now(), phase: 'pending',
    kind, draftIdentity: kind + ':original', operationUuid, requestKey: 'original',
    ...(kind === 'source' ? { intentUuid } : { legacyId: 19 }),
    path: kind === 'source' ? '/disposals/handling-sources' : '/disposals/19/sign-conversion',
    action: kind === 'source' ? 'disposal.handling.source.create' : 'disposal.handling.legacy.convert.19',
    body: kind === 'source'
      ? { operationUuid, intentUuid, productId: 3, warehouseId: 8, unit: '个', handlingType: 1, quantity: 2 }
      : { operationUuid, snapshotFingerprint: 'a'.repeat(64), reason: '原完整快照核对' },
  }
}
test.each(['source', 'conversion'] as const)('撤VIEW/写权后重挂auth-only本人%s恢复，仅精确GET、conversion不伪造intent', async kind => {
  const record = recoveryRecord(kind)
  saveHandlingRecord(record)
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [] } })
  const seen: import('axios').InternalAxiosRequestConfig[] = []
  client.defaults.adapter = async c => {
    seen.push(c)
    if (c.method !== 'get' || c.url !== `/disposals/handling-operations/${record.operationUuid}`) {
      unknown.push(c.method + ' ' + c.url); throw Error('recovery cannot read business')
    }
    return reply(c, { status: 'not_found', data: null })
  }
  await leaf(RecoveryPage, '/disposals/recovery', async host => {
    expect(seen).toEqual([])
    await click('查询原处理结果')
    expect(seen).toHaveLength(1)
    expect(seen[0].baseURL).toBe('/a')
    expect(seen[0].params).toEqual({ action: record.action, requestKey: record.requestKey, ...(kind === 'source' ? { intentUuid } : {}) })
    expect(host.textContent).toContain('暂未找到原结果')
    expect(readHandlingRecords()).toHaveLength(1)
    expect(host.querySelector('input')).toBeNull()
  })
})
test('来源解除Portal关闭并重开保说明；隐藏或owner ABA旧提交回调不POST', async () => {
  posts.length = 0; actualAdapter({ release: true })
  await page('/disposals', async () => {
    await click('核对解除')
    await input(document.querySelector<HTMLInputElement>('[aria-label="解除说明"]')!, '保留核对说明')
    await click('关闭并保留说明'); await click('核对解除')
    expect(document.querySelector<HTMLInputElement>('[aria-label="解除说明"]')!.value).toBe('保留核对说明')
    const old = [...document.querySelectorAll('button')].find(b => b.textContent === '确认核对解除')!
    await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); old.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(posts).toEqual([])
    expect(document.querySelector('[aria-label="解除说明"]')).toBeNull()
  })
})

test('处理意图首次打开捕获当前server，未访问空Dialog不预先绑旧owner', async () => {
  actualAdapter()
  await page('/disposals', async () => {
    await act(async () => setApiClientBaseURL('/b'))
    await click('保存处理意图')
    expect(document.querySelector('[aria-label="意图基本量"]')).not.toBeNull()
  })
})
