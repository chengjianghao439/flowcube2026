// @vitest-environment jsdom
import { act } from 'react'
import { webcrypto } from 'node:crypto'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useCriticalPdaAction } from './useCriticalPdaAction'
import { useAuthStore } from '@/store/authStore'
import { setApiClientBaseURL } from '@/api/client'
import type { User } from '@/types'
const api = vi.hoisted(()=>({receipt:vi.fn(),retry:vi.fn(),weak:vi.fn(),confirmed:vi.fn()}))
vi.mock('@/hooks/useNetworkStatus',()=>({useNetworkStatus:()=> 'online'}))
vi.mock('@/api/operation-requests',()=>({getOperationRequestStatusApi:api.receipt}))
let mode: 'receive' | 'stockcheck' = 'receive'
let root:Root, critical:ReturnType<typeof useCriticalPdaAction>
const body={productId:3,packages:[{qty:2},{qty:1}],batchNo:'合成批次',confirmDuplicate:true}
async function mount(){root=createRoot(document.createElement('div'));function Probe(){critical=useCriticalPdaAction({action:mode === 'receive' ? 'inbound.receive.7' : 'stockcheck.scan.11',label:'作业',onConfirmed:api.confirmed,resolveServerState:api.weak,retryExecutor:api.retry});return null}await act(async()=>root.render(<Probe/>))}
beforeEach(async()=>{
 Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })

 mode = 'receive'
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});localStorage.clear()
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request: async (_name: string, options: unknown, fn?: (lock: object) => unknown) => (typeof options === 'function' ? options : fn!)({})}})
 api.receipt.mockReset().mockResolvedValue({status:'not_found',data:null});api.retry.mockReset();api.confirmed.mockClear();api.weak.mockReset().mockResolvedValue({effective:true,data:{}})
 setApiClientBaseURL('/api');useAuthStore.getState().login('synthetic',null,{id:1,roleId:1} as User);await mount()
})
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();useAuthStore.getState().logout()})
async function first(status=503){await act(async()=>{await critical.run(async()=>{throw Object.assign(Error('synthetic'),{status})},{taskId:7,requestBody:body})});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))});return critical.pendingRecord!}
test.each([500,502,503,504])('%s与原receipt缺失/处理中不能用当前进度认领原成功',async status=>{
 const original=await first(status)
 expect(critical.submitBlocked).toBe(true);expect(api.weak).not.toHaveBeenCalled();expect(api.confirmed).not.toHaveBeenCalled()
 expect(original.metadata?.requestBody).toEqual(body)
 api.receipt.mockResolvedValue({status:'pending',data:{}})
 await act(async()=>{await critical.confirmPending()})
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey)
 await act(async()=>critical.clearPending())
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey)
})
test('重挂、登出重登保留完整原正文/原键，换账号不继承正文',async()=>{
 const original=await first()
 await act(async()=>root.unmount());await mount()
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey)
 await act(async()=>{useAuthStore.getState().logout();useAuthStore.getState().login('other',null,{id:2} as User)})
 expect(critical.pendingRecord).toBeNull()
 await act(async()=>useAuthStore.getState().login('again',null,{id:1} as User))
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey);expect(critical.pendingRecord?.metadata?.requestBody).toEqual(body)
})
test('显式先查not_found后同键/body重试，恢复重试4xx仍保留原键',async()=>{
 const original=await first()
 api.retry.mockImplementation(async(record,key)=>{expect(record.metadata.requestBody).toEqual(body);expect(key).toBe(original.requestKey);throw Object.assign(Error('current conflict'),{status:409})})
 await act(async()=>{await critical.retryPending()})
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey)
 api.retry.mockResolvedValue({containers:[]})
 await act(async()=>{await critical.retryPending()})
 expect(critical.pendingRecord).toBeNull();expect(api.confirmed).toHaveBeenCalledOnce()
})
test('回执403/503仍未决，原success/failed才结束',async()=>{
 const original=await first()
 for(const status of [403,503]){api.receipt.mockRejectedValue(Object.assign(Error('receipt unavailable'),{status}));await act(async()=>{await critical.confirmPending()});expect(critical.pendingRecord?.requestKey).toBe(original.requestKey)}
 api.receipt.mockResolvedValue({status:'failed',data:null,message:'明确未执行'})
 await act(async()=>{await critical.confirmPending()})
 expect(critical.pendingRecord).toBeNull();expect(api.confirmed).not.toHaveBeenCalled()
})
test('服务器切换不将旧原键查询或重发到新服务器',async()=>{
 const original=await first(),receiptCalls=api.receipt.mock.calls.length
 await act(async()=>setApiClientBaseURL('/other-api'))
 await act(async()=>{await critical.confirmPending();await critical.retryPending().catch(()=>{})})
 expect(api.receipt).toHaveBeenCalledTimes(receiptCalls);expect(api.retry).not.toHaveBeenCalled()
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey)
 await act(async()=>setApiClientBaseURL('/api'))
})
test('Web Locks缺失或另一窗口持锁时首次不发送',async()=>{
 const executor=vi.fn()
 Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
 await act(async()=>{await expect(critical.run(executor)).rejects.toThrow('此客户端')})
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,_o:unknown,fn:(lock:null)=>unknown)=>fn(null)}})
 await act(async()=>{await expect(critical.run(executor)).rejects.toThrow('另一窗口')})
 expect(executor).not.toHaveBeenCalled()
})

test('正文与持久摘要不符时不查询、不重发、不确认原操作', async () => {
 const original=await first(),key=`pda_owned_request_v3:1:${original.requestKey}`
 localStorage.setItem(key,JSON.stringify({...original,metadata:{...original.metadata,requestBody:{...body,packages:[{qty:4}]}}}))
 const reads=api.receipt.mock.calls.length
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key})))
 await act(async()=>{await critical.confirmPending();await critical.retryPending().catch(()=>{})})
 expect(api.receipt).toHaveBeenCalledTimes(reads);expect(api.retry).not.toHaveBeenCalled();expect(api.confirmed).not.toHaveBeenCalled()
 expect(critical.submitBlocked).toBe(true)
})
test('原记录缺失且无终态不会据此解除本页已观察过的原操作', async () => {
 const original=await first(),key=`pda_owned_request_v3:1:${original.requestKey}`
 localStorage.removeItem(key)
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key})))
 expect(critical.submitBlocked).toBe(true);expect(critical.pendingRecord?.requestKey).toBe(original.requestKey)
 const executor=vi.fn()
 await act(async()=>{await critical.run(executor).catch(()=>{})})
 expect(executor).not.toHaveBeenCalled()
})

test.each([{ resourceType:'stockcheck',resourceId:7 },{ resourceType:'inbound_task',resourceId:8 }])('错资源结果不会结束原键：%j',async wrong=>{
 const original=await first()
 api.receipt.mockResolvedValue({status:'success',data:{},...wrong})
 await act(async()=>{await critical.confirmPending()})
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey);expect(api.confirmed).not.toHaveBeenCalled()
})
test('冷启动合法但不一致的收货单定位全域阻断，不自动选择另一单或换键',async()=>{
 const original=await first(),key=`pda_owned_request_v3:1:${original.requestKey}`
 localStorage.setItem(key,JSON.stringify({...original,action:'inbound.receive.8',requestAction:'inbound.receive.8'}))
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key})))
 await act(async()=>root.unmount());await mount()
 expect(critical.submitBlocked).toBe(true)
 const executor=vi.fn()
 await act(async()=>{await critical.run(executor).catch(()=>{})})
 expect(executor).not.toHaveBeenCalled();expect(api.confirmed).not.toHaveBeenCalled()
})

test('盘点成功结果须精确原itemId，另一商品的相同条码数/总量不能确认',async()=>{
 await act(async()=>root.unmount());mode='stockcheck';await mount()
 await act(async()=>{await critical.run(async()=>{throw Object.assign(Error('synthetic'),{status:503})},{checkId:11,itemId:9,requestBody:{scans:[{barcode:'I1',countedQty:2},{barcode:'I2',countedQty:0}]}})})
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))})
 const original=critical.pendingRecord!
 api.receipt.mockResolvedValue({status:'success',resourceType:'stockcheck',resourceId:11,data:{itemId:10,scannedContainers:2,actualQty:2}})
 await act(async()=>{await critical.confirmPending()})
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey);expect(api.confirmed).not.toHaveBeenCalled()
 api.receipt.mockResolvedValue({status:'success',resourceType:'stockcheck',resourceId:11,data:{itemId:9,scannedContainers:2,actualQty:2}})
 await act(async()=>{await critical.confirmPending()})
 expect(critical.pendingRecord).toBeNull();expect(api.confirmed).toHaveBeenCalledOnce()
})

test('compact终态的旧标签只能GET原结果详情，缺结果不调用success或原键POST',async()=>{
 const original=await first(),requestKey=`pda_owned_request_v3:1:${original.requestKey}`
 const {completeTerminalSlot}=await import('@/lib/criticalTerminalStorage')
 await completeTerminalSlot(`pda_owned_terminal_v3:1:${original.requestKey}`,original,'success');localStorage.removeItem(requestKey)
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:requestKey})))
 expect(critical.pendingRecord?.requestKey).toBe(original.requestKey);expect(api.confirmed).not.toHaveBeenCalled()
 await act(async()=>{await critical.retryPending().catch(()=>{})});expect(api.retry).not.toHaveBeenCalled();expect(api.confirmed).not.toHaveBeenCalled()
 api.receipt.mockResolvedValue({status:'success',resourceType:'inbound_task',resourceId:7,data:{containers:[{containerId:123}]}})
 await act(async()=>{await critical.confirmPending()})
 expect(critical.pendingRecord).toBeNull();expect(api.confirmed).toHaveBeenCalledWith({containers:[{containerId:123}]},expect.objectContaining({recovered:true,requestKey:original.requestKey}))
})
test('年轻终态预算满或WebCrypto缺失，首次执行器不调用；未决完整正文不删',async()=>{
 const executor=vi.fn()
 for(let i=0;i<4096;i++)localStorage.setItem(`pda_owned_terminal_v3:2:${i}`,JSON.stringify({terminalVersion:2,requestHash:'a'.repeat(64),createdAt:Date.now(),state:'success'}))
 const unknown='pda_owned_request_v3:2:other';localStorage.setItem(unknown,'{"keep":"unknown"}')
 await act(async()=>{await expect(critical.run(executor)).rejects.toThrow('容量已满')})
 expect(executor).not.toHaveBeenCalled();expect(localStorage.getItem(unknown)).toBe('{"keep":"unknown"}')
 localStorage.clear();Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}})
 await act(async()=>{await expect(critical.run(executor)).rejects.toThrow('无法安全保存')});expect(executor).not.toHaveBeenCalled()
})
test('实际执行成功但终态存储抛quota仍保留原键/body，恢复存储后GET结束零重发',async()=>{
 const set=Storage.prototype.setItem,executor=vi.fn().mockResolvedValue({containers:[{containerId:123}]})
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,v){if(k.startsWith('pda_owned_terminal_v3:')&&v.includes('"state":"success"'))throw Error('synthetic quota');set.call(this,k,v)})
 await act(async()=>{expect((await critical.run(executor,{taskId:7,requestBody:body})).kind).toBe('pending')})
 const original=critical.pendingRecord!;expect(original.metadata?.requestBody).toEqual(body)
 vi.restoreAllMocks();api.receipt.mockResolvedValue({status:'success',data:{containers:[{containerId:123}]}})
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))})
 await act(async()=>{await critical.confirmPending()});expect(critical.pendingRecord).toBeNull();expect(executor).toHaveBeenCalledOnce();expect(api.retry).not.toHaveBeenCalled()
})

test('另一窗口在预留await后完成原键，迟到首POST守卫不调用执行器',async()=>{
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,opts:unknown,fn?:(lock:object)=>unknown)=>{const value=await(typeof opts==='function'?opts():fn!({}));if(name==='flowcube-critical-terminal-v2'){const key=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)!).find(k=>k.startsWith('pda_owned_terminal_v3:'))!;const marker=JSON.parse(localStorage.getItem(key)!);if(marker.state==='reserved')localStorage.setItem(key,JSON.stringify({...marker,state:'success'}))}return value}}})
 const executor=vi.fn()
 await act(async()=>{expect((await critical.run(executor,{taskId:7,requestBody:body})).kind).toBe('pending')})
 expect(executor).not.toHaveBeenCalled();expect(critical.pendingRecord?.metadata?.requestBody).toEqual(body);expect(api.confirmed).not.toHaveBeenCalled()
})
