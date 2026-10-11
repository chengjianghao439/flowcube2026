// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { DocumentActivityPanel } from './DocumentActivityPanel'
const mocks = vi.hoisted(() => ({ get: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/document-activity', () => ({ getDocumentActivityApi: mocks.get }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
const records = { status: '草稿', sections: [], events: [{ id: 'event', title: '原单记录', createdAt: '2026-10-09', createdByName: '记录人' }], historyNote: '历史记录提示' }
let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks(); mocks.defaults.baseURL = '/a'
  mocks.get.mockResolvedValue(records)
  useAuthStore.setState({ token: 'test', user: { id: 5, roleId: 5 } as never, sessionGeneration: 10 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })
async function render(active = true, owned = true) {
  await act(async () => root.render(<QueryClientProvider client={client}><SectionVisibilityContext.Provider value={active}><DocumentActivityPanel type="sale" id={80} view="log" readOwner={owned ? owner : undefined} /></SectionVisibilityContext.Provider></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
}
test('默认记录入口保留原query身份、完整记录及重新加载', async () => {
  await render(true, false)
  expect(client.getQueryData(['document-activity', 'sale', 80])).toEqual(records)
  expect(host.textContent).toContain('原单记录')
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '刷新')!.click())
  expect(mocks.get).toHaveBeenCalledTimes(2)
  expect(mocks.get.mock.calls.every(call => call[3] === undefined)).toBe(true)
})
test('成套读取固定原账号服务器，隐藏区块暂停，回来沿同一来源读', async () => {
  await render(false)
  expect(mocks.get).not.toHaveBeenCalled()
  await render(true)
  expect(mocks.get.mock.calls[0].slice(0, 2)).toEqual(['sale', 80])
  expect(mocks.get.mock.calls[0][3]).toEqual(owner)
  expect(client.getQueryData(['document-activity', 'sale', 80, '/a', 5, 10])).toEqual(records)
})
test('迟到记录在服务器切换后不作为当前原单记录呈现', async () => {
  let resolve!: (value: typeof records) => void
  mocks.get.mockReturnValue(new Promise(value => { resolve = value }))
  await render()
  mocks.defaults.baseURL = '/b'
  await act(async () => { resolve(records); await new Promise(value => setTimeout(value, 5)) })
  expect(host.textContent).not.toContain('原单记录')
  expect(host.textContent).toContain('读取来源已变化')
})
test('登录状态已变化时不查询旧来源或接受已有记录', async () => {
  useAuthStore.setState({ sessionGeneration: 11 })
  await render()
  expect(mocks.get).not.toHaveBeenCalled()
  expect(host.textContent).toContain('读取来源已变化')
})

test('有效v1变更先显示一次原因，展开保留两位数量与四位单价', async () => {
  mocks.get.mockResolvedValue({ ...records, events:[{ id:'change-1',title:'编辑订单',description:'变更1行',createdAt:'2026-10-10',createdByName:'合成操作人',source:'业务变更',payload:{version:1,kind:'line_changes',reason:'客户修改数量',quantityScale:2,priceScale:4,actors:{operator:{id:5,name:'合成操作人',role:'operator'}},context:{phase:'draft_edit'},rows:[{key:'product:7:1',action:'changed',before:{kind:'physical',productId:7,productCode:'SYN-7',productName:'合成商品',warehouseId:1,quantity:'1.20',unitPrice:'1.2345',amount:'1.4814',unit:'件',components:[]},after:{kind:'physical',productId:7,productCode:'SYN-7',productName:'合成商品',warehouseId:1,quantity:'2.30',unitPrice:'1.2356',amount:'2.8419',unit:'件',components:[]}}]}}] })
  await render(true,false)
  expect(host.textContent).toContain('客户修改数量')
  const summary=host.querySelector('details summary')
  expect(summary).not.toBeNull()
  await act(async()=>{summary!.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  expect(host.textContent).toContain('1.20');expect(host.textContent).toContain('2.30')
  expect(host.textContent).toContain('1.2345');expect(host.textContent).toContain('1.2356')
  expect(host.textContent!.split('客户修改数量').length-1).toBe(1)
})
test('旧或未知版本保留摘要且不输出未经白名单校验的JSON', async () => {
  mocks.get.mockResolvedValue({ ...records, events:[{id:'legacy',title:'历史编辑',description:'原摘要保留',createdAt:'2026-10-10',payload:{version:99,reason:'UNTRUSTED',raw:'DO-NOT-SHOW'}}] })
  await render(true,false)
  expect(host.textContent).toContain('原摘要保留')
  expect(host.textContent).not.toContain('UNTRUSTED');expect(host.textContent).not.toContain('DO-NOT-SHOW')
  expect(host.querySelector('details')).toBeNull()
})

test('套件记录用保存的资料说明原版本依据并保留实际编号', async () => {
  mocks.get.mockResolvedValue({ ...records, events: [{ id: 'kit-change', title: '修改明细', createdAt: '2026-10-10', payload: {
    version: 1, kind: 'line_changes', reason: null, quantityScale: 2, priceScale: 4, actors: {}, context: {},
    rows: [{ key: 'group:kit-9', action: 'added', before: null, after: {
      kind: 'kit', productCode: 'SYN-KIT', productName: '合成套件', quantity: '1.00', unitPrice: '2.0000',
      kitVersionId: 9, snapshotRevision: 3, components: [],
    } }],
  } }] })
  await render(true, false)
  expect(host.textContent).toContain('套件版本 #9 · 保存的资料 3')
  expect(host.textContent).not.toContain('快照')
})


test('合法前后集合合并800行完整呈现，删除行不会因长度丢失',async()=>{
  const rows=Array.from({length:800},(_,index)=>({key:`product:${index}`,action:'removed',before:{kind:'physical',productCode:`SYN-${index}`,productName:`合成商品${index}`,quantity:'1.00',unitPrice:'1.2345',components:[]},after:null}))
  mocks.get.mockResolvedValue({...records,events:[{id:'large',title:'编辑订单',description:'变更800行',createdAt:'2026-10-10',payload:{version:1,kind:'line_changes',reason:'批量调整',quantityScale:2,priceScale:4,rows,actors:{},context:{}}}]})
  await render(true,false)
  expect(host.querySelector('details summary')?.textContent).toContain('800')
  expect(host.textContent).toContain('合成商品799')
  expect(host.querySelectorAll('details tbody tr')).toHaveLength(800)
})
