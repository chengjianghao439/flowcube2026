// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { webcrypto } from 'node:crypto'
import { TextEncoder } from 'node:util'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import Page from './create'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { setApiClientBaseURL } from '@/api/client'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import type { User } from '@/types'
import type { InboundPurchaseCandidate } from '@/types/inbound-tasks'
const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/api/inbound-tasks', () => ({ createInboundTaskApi: api.post }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.get }))
vi.mock('@/hooks/useInvalidate', () => ({ useInvalidate: () => api.invalidate }))
vi.mock('@/hooks/useInboundTasks', async () => ({ useCreateInboundTask: (await import('@/hooks/useInboundTaskCreateRecovery')).useInboundTaskCreateRecovery }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/finder', () => ({ SupplierFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (s: object) => void }) => open ? <button onClick={() => onConfirm({ id: 1, name: '合成供应商' })}>确定供应商</button> : null }))
vi.mock('./PurchaseItemPickerDialog', () => ({ PurchaseItemPickerDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (rows: object[]) => void }) => open ? <button onClick={() => onConfirm([{ item: { purchaseItemId: 41, purchaseOrderNo: 'PO41', productName: '合成商品', warehouseId: 2, warehouseName: '合成仓', remainingQty: 10, unit: '个', unitPrice: 3.4567 } as InboundPurchaseCandidate, qty: 1.25 }])}>确定来源</button> : null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let uid = 91000
const windows: { host: HTMLDivElement; root: Root }[] = []
const record = () => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('flowcube-inbound-create-v1:request:'))!)!)
async function mount() {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), w = {host, root}; windows.push(w)
 await act(async () => root.render(<MemoryRouter initialEntries={['/inbound-tasks/new']}><Routes><Route path="/inbound-tasks/new" element={<TabPathContext.Provider value="/inbound-tasks/new"><Page /></TabPathContext.Provider>} /><Route path="/inbound-tasks/:id" element={<p>原单详情</p>} /></Routes></MemoryRouter>));return w
}
const field = (w: typeof windows[number], name: string) => { const label = [...w.host.querySelectorAll('label')].find(l => l.textContent === name)!; return [...w.host.querySelectorAll('[id]')].find(el => el.id === label.htmlFor) as HTMLInputElement }
const button = (w: typeof windows[number], name: string) => [...w.host.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!
const click = (w: typeof windows[number], name: string) => act(async () => button(w,name).click())
// 点击不会等待异步事件处理器；保留真实 WebCrypto，按页面忙状态等待恢复完成。
const idle = async (w: typeof windows[number]) => { await vi.waitFor(async () => { await act(async () => {}); expect(button(w, '创建中…')).toBeUndefined() }) }
const fill = (w: typeof windows[number], name: string, value: string) => act(async () => { const el=field(w,name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true})) })
async function draft(w: typeof windows[number], remark='原窗口旧正文') { await act(async()=>field(w,'供应商 *').click());await click(w,'确定供应商');await click(w,'选择商品');await click(w,'确定来源');await fill(w,'备注',remark);await fill(w,'运费金额','0') }
beforeEach(()=>{ uid++;localStorage.clear();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('TextEncoder',TextEncoder);vi.stubGlobal('ResizeObserver',class { observe(){} disconnect(){} unobserve(){} });setApiClientBaseURL('/api');api.post.mockReset().mockRejectedValue(new Error('丢响应'));api.get.mockReset().mockImplementation(async()=>{const r=record();return {status:'success',resourceType:'inbound_task',resourceId:81,data:{taskId:81,taskNo:'IT81',warehouseId:2,requestFingerprint:r.fingerprint}}});api.invalidate.mockClear();act(()=>useAuthStore.getState().login('synthetic',null,{id:uid,roleId:99,permissions:[P.INBOUND_ORDER_CREATE,P.INBOUND_ORDER_VIEW]} as User)) })
afterEach(async()=>{for(const w of windows){await act(async()=>w.root.unmount());w.host.remove()}windows.length=0;useDirtyGuardStore.setState({dirtyTabs:{},pendingConfirm:null});act(()=>useAuthStore.getState().logout());vi.unstubAllGlobals();vi.restoreAllMocks()})
test('另一窗口确认并清理后，恢复过原请求的窗口不能换键重发旧正文',async()=>{
 const a=await mount();await draft(a);await click(a,'创建收货订单');await idle(a);expect(api.post).toHaveBeenCalledTimes(1);const originalKey=api.post.mock.calls[0][2]
 const b=await mount();expect(field(b,'备注').value).toBe('原窗口旧正文');await click(b,'查询原创建结果');await idle(b);expect(b.host.textContent).toContain('原单详情')
 await click(a,'创建收货订单');await idle(a);expect(api.post).toHaveBeenCalledTimes(1);expect(field(a,'备注').value).toBe('');expect(field(a,'运费金额').value).toBe('');expect(a.host.textContent).not.toContain('合成商品');expect(originalKey).toBeTruthy()
})

test('另一窗口终态只清理已绑定的原表单，无关未发送草稿保持原值',async()=>{
 const a=await mount();await draft(a,'无关新草稿');const b=await mount();await draft(b);await click(b,'创建收货订单');await idle(b)
 expect(field(a,'备注').value).toBe('无关新草稿');expect(field(a,'备注').disabled).toBe(true)
 await click(b,'查询原创建结果');await idle(b);expect(field(a,'备注').value).toBe('无关新草稿');expect(field(a,'运费金额').value).toBe('0');expect(a.host.textContent).toContain('合成商品');expect(field(a,'备注').disabled).toBe(false);expect(api.post).toHaveBeenCalledTimes(1)
})
test('没有终态而原记录消失仍冻结旧正文，不能以缺失推断新单',async()=>{
 const a=await mount();await draft(a);await click(a,'创建收货订单');await idle(a);const key=Object.keys(localStorage).find(k=>k.startsWith('flowcube-inbound-create-v1:request:'))!
 await act(async()=>{localStorage.removeItem(key);window.dispatchEvent(new StorageEvent('storage',{key,newValue:null}))})
 expect(field(a,'备注').value).toBe('原窗口旧正文');expect(field(a,'备注').disabled).toBe(true);await click(a,'创建收货订单');await idle(a);expect(api.post).toHaveBeenCalledTimes(1);expect(a.host.textContent).toContain('没有可核对终态')
})
test('完成后重开为空；迟到storage通知与旧pending回填都不能复活正文',async()=>{
 const a=await mount();await draft(a);await click(a,'创建收货订单');await idle(a);const key=Object.keys(localStorage).find(k=>k.startsWith('flowcube-inbound-create-v1:request:'))!,raw=localStorage.getItem(key)!
 const b=await mount();await click(b,'查询原创建结果');await idle(b);const c=await mount();expect(field(c,'备注').value).toBe('')
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key,newValue:raw})));expect(field(a,'备注').value).toBe('');expect(field(c,'备注').value).toBe('')
 await act(async()=>{localStorage.setItem(key,raw);window.dispatchEvent(new StorageEvent('storage',{key,newValue:raw}))})
 expect(field(a,'备注').value).toBe('');expect(field(c,'备注').value).toBe('');expect(api.post).toHaveBeenCalledTimes(1);expect(localStorage.getItem(key)).toBeNull()
})
test.each(['success','rollback'])('另一窗口已确认后，首发迟到%s不能导航、覆盖终态或复活旧正文',async outcome=>{
 let resolve!:(v:unknown)=>void,reject!:(v:unknown)=>void;api.post.mockImplementation(()=>new Promise((ok,fail)=>{resolve=ok;reject=fail}))
 const a=await mount();await draft(a);await click(a,'创建收货订单');await act(async()=>{await vi.waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1))});const original=record()
 const b=await mount()
 // 两个真实浏览器各有独立 flights；本测试两 React root 共用模块，用独立窗口的 storage 写入模拟终态传播。
 await act(async()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('flowcube-inbound-create-v1:request:'))!;const terminalKey=key.replace(':request:',':terminal:');localStorage.setItem(terminalKey,JSON.stringify({...original,phase:'confirmed',result:{taskId:81,taskNo:'IT81',warehouseId:2,requestFingerprint:original.fingerprint}}));localStorage.removeItem(key);window.dispatchEvent(new StorageEvent('storage',{key:terminalKey}))})
 expect(field(a,'备注').value).toBe('');expect(field(b,'备注').value).toBe('')
 await act(async()=>{if(outcome==='success')resolve({taskId:81,taskNo:'IT81',warehouseId:2,requestFingerprint:original.fingerprint});else reject({status:400,data:{inboundCreateNotExecuted:true},message:'迟到回滚'})})
 expect(field(a,'备注').value).toBe('');expect(a.host.textContent).not.toContain('原单详情');expect(api.post).toHaveBeenCalledTimes(1);const terminal=Object.keys(localStorage).find(k=>k.startsWith('flowcube-inbound-create-v1:terminal:'))!;expect(JSON.parse(localStorage.getItem(terminal)!).phase).toBe('confirmed')
})
test('明确未执行的终态跨页面同步，保留失败输入；主动修改后才可新键创建',async()=>{
 let reject!:(v:unknown)=>void;api.post.mockImplementationOnce(()=>new Promise((_ok,fail)=>{reject=fail}))
 const a=await mount();await draft(a);await click(a,'创建收货订单');await act(async()=>{await vi.waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1))});const oldKey=api.post.mock.calls[0][2]
 const b=await mount();await act(async()=>reject({status:400,data:{inboundCreateNotExecuted:true},message:'已回滚未执行'}))
 expect(field(a,'备注').value).toBe('原窗口旧正文');expect(field(b,'备注').value).toBe('原窗口旧正文');expect(field(a,'备注').disabled).toBe(false);expect(field(b,'备注').disabled).toBe(false);expect(api.post).toHaveBeenCalledTimes(1)
 await fill(b,'备注','失败后新意图');await click(b,'创建收货订单');await act(async()=>{await vi.waitFor(()=>expect(api.post).toHaveBeenCalledTimes(2))});expect(api.post.mock.calls[1][2]).not.toBe(oldKey);expect(api.post.mock.calls[1][0].remark).toBe('失败后新意图')
})
