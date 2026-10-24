// @vitest-environment jsdom
import { act } from 'react'
import userEvent from '@testing-library/user-event'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import clientApi, { setApiClientBaseURL } from '@/api/client'
import ReservationDetailsDialog from './ReservationDetailsDialog'
import InventoryPage from './index'
const api = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn(async () => null) }))
vi.mock('@/api/inventory', () => ({ getInventoryReservationsApi: api.read, getInventoryReservationSnapshotApi: api.read }))
vi.mock('@/hooks/useInventory', () => ({ useInventoryOverview: () => ({ data: { list: [{ id: 1, productId: 7, warehouseId: 8, productName: '商品A', warehouseName: '仓库A', onHand: 40, reserved: 0, available: 40 }], pagination: { total: 1 } } }), useLogs: () => ({ data: { list: [] } }), useOutbound: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: [] }) }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
vi.mock('@/components/shared/ContainerDrawer', () => ({ default: () => null }))
vi.mock('@/components/finder', () => ({ ProductFinder: () => null }))
vi.mock('@/components/ui/dialog', async importOriginal => ({ ...await importOriginal<typeof import('@/components/ui/dialog')>(), Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null, DialogHeader: ({ children, description }: { children: React.ReactNode; description?: React.ReactNode }) => <div>{children}<div className="fc-dialog-caption">{description}</div></div>, ...Object.fromEntries(['Content', 'Title', 'Footer', 'Description'].map(k => [`Dialog${k}`, ({ children }: { children: React.ReactNode }) => <div>{children}</div>])) }))
const item = { productId: 7, warehouseId: 8, productName: '商品A', warehouseName: '仓库A', unit: '件' }
function result(productId = 7, warehouseId = 8, orderNo = 'SO-当前') {
  const legacy = { productId, warehouseId, summary: { activeQuantity: 30, cacheOnHand: 32, reserved: 50, available: 0, expected: 25, atp: 5, pickableQuantity: 12, reservationQuantity: 40, expectedBindingQuantity: 33, expectedPoolBindingQuantity: 25, cacheDifference: 2, reservationDifference: 10, bindingPoolDifference: 8, visibleReservationQuantity: 20, hiddenReservationQuantity: 12, orphanReservationQuantity: 6, unknownReservationQuantity: 2, visibleBindingQuantity: 28, hiddenBindingQuantity: 5, orphanBindingQuantity: 0 }, list: [{ saleOrderId: 11, orderNo, customerName: '授权客户', status: 2, createdAt: '2026-10-04 10:00:00', reservationQuantity: 20, expectedBindingQuantity: 28, hiddenBindingQuantity: 0, orphanBindingQuantity: 3, bindings: [{ bindingId: 1, saleOrderItemId: 41, quantity: 25, sourceState: 'expected_supply', purchase: { purchaseOrderId: 201, purchaseItemId: 301, orderNo: 'PO-当前', status: 2, openQuantity: 25, boundQuantity: 25 } }] }], pagination: { page: 1, pageSize: 20, total: 21 } }
  const clock = Date.now()
  const source = legacy.list[0], { bindings, ...details } = source
  return { ...legacy, rows: [{ id: 'sale:11', kind: 'sale' as const, saleOrderId: 11, source: details }, ...bindings.map(binding => ({ id: 'binding:' + binding.bindingId, kind: 'binding' as const, saleOrderId: 11, orderNo, binding }))],
    snapshot: { snapshotId: '00000000-0000-4000-8000-000000000001', readAt: new Date(clock).toISOString(), expiresAt: new Date(clock+120000).toISOString(), totalRows: 2, totalSources: 1, offset: 0, nextOffset: null as number | null } }

}
let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); useAuthStore.setState({ sessionGeneration: 1, user: { id: 9, username: 'test', realName: '测试', roleId: 1, roleName: '测试' } }); api.read.mockReset().mockResolvedValue(result()); clientApi.defaults.baseURL = '/api'; client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300000 } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function flush() { await act(async () => { await new Promise(done => setTimeout(done, 35)) }) }
function draw(nextItem = item, open = true, active = true) { act(() => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/inventory']}><KeepAliveSection active={active}><ReservationDetailsDialog item={nextItem} open={open} onClose={() => {}} /></KeepAliveSection></MemoryRouter></QueryClientProvider>)) }

test('真实弹窗连续加载同快照尾行，无可见分页且保留原单链接', async () => {
  const first=result()
  const extra=Array.from({length:98},(_,i)=>({id:'sale:'+(12+i),kind:'sale' as const,saleOrderId:12+i,source:{...first.list[0],saleOrderId:12+i,orderNo:'SO-'+i}}))
  first.rows=[...first.rows,...extra]
  first.snapshot={...first.snapshot,totalRows:101,totalSources:100,nextOffset:100}
  const next={...first,rows:[{id:'sale:110',kind:'sale' as const,saleOrderId:110,source:{...first.list[0],saleOrderId:110,orderNo:'SO-尾行'}}],snapshot:{...first.snapshot,offset:100,nextOffset:null}}
  api.read.mockImplementation(async ({offset})=>offset===100?next:first)
  draw();await flush();await flush()
  expect(host.textContent).toContain('实物在库');expect(host.textContent).toContain('含预计可承诺')
  expect(host.querySelector('a[href="/sale/11"]')).not.toBeNull();expect(host.querySelector('a[href="/purchase/201"]')).not.toBeNull()
  expect(host.textContent).not.toMatch(/上一页|下一页|第 1 \/|第 1\//)
  const scroll=host.querySelector<HTMLElement>('[data-table-scroll]')
  expect(scroll).not.toBeNull()
  Object.defineProperties(scroll!,{scrollHeight:{value:1000,configurable:true},clientHeight:{value:500,configurable:true},scrollTop:{value:600,writable:true,configurable:true}})
  act(()=>scroll!.dispatchEvent(new Event('scroll',{bubbles:true})));await flush();await flush()
  expect(api.read.mock.calls.at(-1)?.[0]).toMatchObject({productId:7,warehouseId:8,offset:100,snapshotId:first.snapshot.snapshotId})
  expect(host.textContent).toContain('SO-尾行');expect(host.textContent).toContain('SO-当前')
})

test('库存总览零预占也可点击解释，保留原在库/可用数值', async () => {
  act(() => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/inventory']}><InventoryPage /></MemoryRouter></QueryClientProvider>))
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="查看商品A在仓库A的预占明细"]')
  expect(button).not.toBeNull(); expect(button?.textContent).toBe('0')
  act(() => button!.click()); await flush(); await flush()
  expect(api.read.mock.calls[0]?.[0]).toEqual({ productId: 7, warehouseId: 8, keyword: '', offset: 0 })
  expect(host.textContent).toContain('库存预占明细')
})
test('维度A迟到不替换B的概要/原单，不能用跨维度placeholder', async () => {
  let resolve!: (value: ReturnType<typeof result>) => void
  api.read.mockImplementation(({ productId, warehouseId }) => productId === 7 ? new Promise(done => { resolve = done }) : Promise.resolve(result(productId, warehouseId, 'SO-B')))
  draw(); await flush(); draw({ ...item, productId: 9, warehouseId: 10 }); await flush(); await flush()
  await act(async () => { resolve(result(7, 8, 'SO-A迟到')); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).toContain('SO-B'); expect(host.textContent).not.toContain('SO-A迟到')
})
test.each(['账号', '权限', '服务器'])('%s变化隔离旧概要和迟到原单', async change => {
  let resolve!: (value: ReturnType<typeof result>) => void
  api.read.mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(result(7, 8, 'SO-新上下文'))
  draw(); await flush()
  if (change === '服务器') act(() => { setApiClientBaseURL('/new-api') })
  else act(() => useAuthStore.setState({ sessionGeneration: 2, user: { id: change === '账号' ? 10 : 9, username: 'new', realName: '测试', roleId: change === '权限' ? 5 : 1, roleName: '测试', permissions: change === '权限' ? [] : undefined } }))
  await flush(); await act(async () => { resolve(result(7, 8, 'SO-旧上下文')); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).not.toContain('SO-旧上下文')
  if (change === '权限') { expect(host.textContent).toContain('没有查看库存的权限'); expect(host.querySelector('.fc-dialog-caption')?.textContent).toBe('没有查看库存的权限'); expect(host.textContent?.match(/没有查看库存的权限/g)).toHaveLength(1) }
  else expect(host.textContent).toContain('SO-新上下文')
})
test('服务器地址变化无需父组件draw，立即移除已显示旧原单并fresh读取', async () => {
  draw(); await flush(); await flush()
  expect(host.textContent).toContain('SO-当前'); expect(host.querySelector('a[href="/sale/11"]')).not.toBeNull()
  let resolve!: (value: ReturnType<typeof result>) => void
  api.read.mockImplementation(() => new Promise(done => { resolve = done }))
  act(() => { setApiClientBaseURL('/new-api') })
  await flush()
  expect(host.textContent).not.toContain('SO-当前'); expect(host.querySelector('a[href="/sale/11"]')).toBeNull()
  expect(api.read.mock.calls.at(-1)?.[1]).toMatchObject({ baseURL: '/new-api' })
  await act(async () => { resolve(result(7, 8, 'SO-新服务器')); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).toContain('SO-新服务器')
})
test('重开及KeepAlive重新激活必须fresh，读取中不显示上次缓存原单', async () => {
  draw(); await flush(); await flush(); expect(host.textContent).toContain('SO-当前')
  let resolve!: (value: ReturnType<typeof result>) => void
  api.read.mockImplementation(() => new Promise(done => { resolve = done }))
  draw(item, false); await flush(); draw(); expect(host.textContent).not.toContain('SO-当前'); await flush()
  await act(async () => { resolve(result(7, 8, 'SO-重开')); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).toContain('SO-重开')
  draw(item, true, false); await flush(); const before = api.read.mock.calls.length
  draw(); expect(host.textContent).not.toContain('SO-重开'); await flush()
  expect(api.read.mock.calls.length).toBe(before + 1)
})
test('返回维度不一致时拒绝原单，失败可显式重试', async () => {
  api.read.mockResolvedValueOnce(result(9, 10, '错维度来源')).mockResolvedValue(result())
  draw(); await flush(); await flush()
  expect(host.textContent).not.toContain('错维度来源'); expect(host.textContent).toContain('读取失败')
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '重试')!.click()); await flush(); await flush()
  expect(host.textContent).toContain('SO-当前')
})

test('关闭在途读取会中止请求，迟到来源不能进入重开新快照', async()=>{
  let resolve!: (value:ReturnType<typeof result>)=>void
  api.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done})).mockResolvedValue(result(7,8,'SO-重开新读'))
  draw();await flush();const signal=api.read.mock.calls[0][1].signal as AbortSignal
  draw(item,false);await flush();expect(signal.aborted).toBe(true)
  draw();await flush();await flush()
  await act(async()=>{resolve(result(7,8,'SO-已关闭迟到'));await new Promise(done=>setTimeout(done,20))})
  expect(host.textContent).toContain('SO-重开新读');expect(host.textContent).not.toContain('SO-已关闭迟到')
})
test('快照已过期时不显示旧精确数量或原单，重试重新读取',async()=>{
  const value=result(),clock=Date.now()
  value.snapshot.readAt=new Date(clock-120001).toISOString();value.snapshot.expiresAt=new Date(clock-1).toISOString()
  api.read.mockResolvedValueOnce(value).mockResolvedValue(result(7,8,'SO-刷新'))
  draw();await flush();await flush()
  expect(host.textContent).toContain('过期');expect(host.textContent).not.toContain('SO-当前')
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='重试')!.click());await flush();await flush()
  expect(host.textContent).toContain('SO-刷新');expect(api.read.mock.calls.at(-1)?.[0]?.offset).toBe(0)
})
test('503不后台重试、不展示旧来源，显式重读可以恢复',async()=>{
  api.read.mockRejectedValueOnce(new Error('预占明细读取繁忙')).mockResolvedValue(result())
  draw();await flush();await flush();expect(api.read).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('读取失败');expect(host.textContent).not.toContain('SO-当前')
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='重试')!.click());await flush();await flush()
  expect(host.textContent).toContain('SO-当前');expect(api.read).toHaveBeenCalledTimes(2)
})
test.each(['sales','bindings'])('5000个%s扁平行只按需分批加载，末行可达且挂载有界',async mode=>{
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    const scroll=this.hasAttribute('data-table-scroll')?this:this.closest<HTMLElement>('[data-table-scroll]')
    const height=this.hasAttribute('data-table-scroll')?320:this.tagName==='TR'?48:0
    return {height,width:900,top:this.hasAttribute('data-table-scroll')?0:-(scroll?.scrollTop??0),left:0,bottom:height,right:900,x:0,y:0,toJSON(){}}
  })
  vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockImplementation(function(this:HTMLElement){return this.hasAttribute('data-table-scroll')?320:this.tagName==='TR'?48:0})
  vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockReturnValue(900)
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}})
  const model=result(),source=model.list[0],binding=model.list[0].bindings[0]
  const rows=mode==='sales'?Array.from({length:5000},(_,i)=>({id:'sale:'+(11+i),kind:'sale' as const,saleOrderId:11+i,source:{...source,saleOrderId:11+i,orderNo:'SO-规模'+i}}))
    :[model.rows[0],...Array.from({length:4999},(_,i)=>({id:'binding:'+(1000+i),kind:'binding' as const,saleOrderId:11,orderNo:source.orderNo,binding:{...binding,bindingId:1000+i,saleOrderItemId:1000+i,purchase:{...binding.purchase,purchaseItemId:300+i}}}))]
  const metadata={...model.snapshot,totalRows:5000,totalSources:mode==='sales'?5000:1}
  api.read.mockImplementation(async({offset=0})=>({...model,rows:rows.slice(offset,offset+100),snapshot:{...metadata,offset,nextOffset:offset+100<5000?offset+100:null}}))
  draw();await flush();await flush();expect(api.read).toHaveBeenCalledTimes(1)
  const scroll=host.querySelector<HTMLElement>('[data-table-scroll]')!
  Object.defineProperty(scroll,'clientHeight',{value:320,configurable:true})
  scroll.scrollTo=vi.fn((options:ScrollToOptions)=>{scroll.scrollTop=options.top||0}) as typeof scroll.scrollTo
  for(let n=1;n<50;n++){
    act(()=>scroll.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})))
    await flush()
    expect(host.querySelectorAll('[data-reservation-row]').length).toBeLessThan(50)
  }
  expect(api.read).toHaveBeenCalledTimes(50);expect(host.textContent).toContain('已读取 5000 / 5000')
  act(()=>{scroll.scrollTop=5000*48-320;scroll.dispatchEvent(new Event('scroll',{bubbles:true}))})
  await flush()
  expect(host.querySelector('[data-reservation-row="'+rows.at(-1)!.id+'"]')).not.toBeNull()
  expect(host.querySelectorAll('[data-reservation-row]').length).toBeLessThan(50)
})

function twoBatches() {
  const first=result()
  first.rows=Array.from({length:100},(_,i)=>({id:'sale:'+(11+i),kind:'sale' as const,saleOrderId:11+i,source:{...first.list[0],saleOrderId:11+i,orderNo:'SO-批次'+i}}))
  first.snapshot={...first.snapshot,totalRows:101,totalSources:101,nextOffset:100}
  const next={...first,rows:[{id:'sale:111',kind:'sale' as const,saleOrderId:111,source:{...first.list[0],saleOrderId:111,orderNo:'SO-终点'}}],snapshot:{...first.snapshot,offset:100,nextOffset:null}}
  return {first,next}
}
test('重复加载同一个游标只产生一个在途请求，不重复追加',async()=>{
  const {first,next}=twoBatches();let resolve!: (value:typeof next)=>void
  api.read.mockImplementation(({offset})=>offset===100?new Promise(done=>{resolve=done}):Promise.resolve(first))
  draw();await flush();await flush()
  const scroll=host.querySelector('[data-table-scroll]')!
  act(()=>{scroll.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));scroll.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))})
  await flush();expect(api.read).toHaveBeenCalledTimes(2)
  await act(async()=>{resolve(next);await new Promise(done=>setTimeout(done,20))})
  expect(host.textContent).toContain('SO-终点');expect(host.textContent).toContain('已读取 101 / 101')
  expect(host.querySelectorAll('[data-reservation-row="sale:111"]')).toHaveLength(1)
})
test('续批失败隐藏未完成来源，重试从0开始，不把旧前缀拼新读',async()=>{
  const {first}=twoBatches()
  api.read.mockImplementation(({offset})=>offset===100?Promise.reject(new Error('读取中断')):Promise.resolve(first))
  draw();await flush();await flush()
  act(()=>host.querySelector('[data-table-scroll]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})))
  await flush();await flush();expect(host.textContent).toContain('读取失败');expect(host.textContent).not.toContain('SO-批次0')
  api.read.mockResolvedValue(result(7,8,'SO-恢复新读'))
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='重试')!.click());await flush();await flush()
  expect(api.read.mock.calls.at(-1)?.[0]?.offset).toBe(0);expect(api.read.mock.calls.at(-1)?.[0]?.snapshotId).toBeUndefined()
  expect(host.textContent).toContain('SO-恢复新读');expect(host.textContent).not.toContain('SO-批次0')
})
test('提交原单关键词建立新读取，保留同商品仓却不复用旧token',async()=>{
  draw();await flush();await flush()
  api.read.mockResolvedValue(result(7,8,'SO-新筛选'))
  const user=userEvent.setup()
  await act(async()=>{await user.type(host.querySelector<HTMLInputElement>('[aria-label="筛选销售原单"]')!,'新筛选');await user.click([...host.querySelectorAll('button')].find(b=>b.textContent==='查询')!)})
  await flush();await flush()
  expect(api.read.mock.calls.at(-1)?.[0]).toMatchObject({keyword:'新筛选',offset:0})
  expect(api.read.mock.calls.at(-1)?.[0]?.snapshotId).toBeUndefined()
  expect(host.textContent).toContain('SO-新筛选');expect(host.textContent).not.toContain('SO-当前')
})

test('同一事件内关闭再重开也不能沿用旧缓存快照',async()=>{
  draw();await flush();await flush();expect(host.textContent).toContain('SO-当前')
  api.read.mockResolvedValue(result(7,8,'SO-立即重开'))
  draw(item,false);draw()
  expect(host.textContent).not.toContain('SO-当前')
  await flush();await flush();expect(api.read).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('SO-立即重开')
})
