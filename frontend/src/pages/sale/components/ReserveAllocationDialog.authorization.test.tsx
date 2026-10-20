// @vitest-environment jsdom
// Real dialog, WarehouseSelect, hooks and API client; closed synthetic HTTP.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import api, { getApiClientBaseURL, setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import Dialog from './ReserveAllocationDialog'

const toasts=vi.hoisted(()=>({error:vi.fn(),success:vi.fn(),warning:vi.fn()}))
vi.mock('@/lib/toast',()=>({toast:toasts}))
const preview={orderId:7,warehouseId:1,warehouseName:'合成仓库',items:[{itemId:17,productId:27,productCode:'SYNTHETIC',productName:'合成商品',unit:'个',quantity:2,reservedQty:0,remainToReserve:2,currentWarehouseId:1,currentWarehouseName:'合成仓库',warehouses:[{warehouseId:1,warehouseName:'合成仓库',available:2},{warehouseId:2,warehouseName:'合成第二仓',available:2}]}]}
let root:Root,host:HTMLDivElement,qc:QueryClient,oldAuth:ReturnType<typeof useAuthStore.getState>
let oldLocks:PropertyDescriptor|undefined
let mayViewWarehouses=false,denyPreview=false,partial=false
const calls:Array<{method:string;path:string;body?:unknown}>=[],unexpected:string[]=[]
const oldAdapter=api.defaults.adapter,oldEnv=api.defaults.env,oldBase=getApiClientBaseURL()
const transport=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const r=input instanceof Request?input:new Request(input,init),u=new URL(r.url),path=u.pathname
 const text=await r.clone().text();calls.push({method:r.method,path,...(text?{body:JSON.parse(text)}:{})})
 let data:unknown,status=200
 if(r.method==='GET'&&path==='/api/sale/7/reserve-preview'){status=denyPreview?403:200;data=partial?{...preview,items:preview.items.map(i=>({...i,reservedQty:1,remainToReserve:1}))}:preview}
 else if(r.method==='GET'&&path==='/api/warehouses/active'){status=mayViewWarehouses?200:403;data=[{id:1,name:'合成仓库'}]}
 else if(r.method==='POST'&&path==='/api/sale/7/reserve')data=null
 else{unexpected.push(`${r.method} ${path}`);throw Error('未登记的网络调用')}
 return new Response(JSON.stringify(status===403?{success:false,code:'PERMISSION_DENIED',message:'无操作权限',data:null}:{success:true,data}),{status,headers:{'Content-Type':'application/json'}})
}
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('crypto',webcrypto)
 oldLocks=Object.getOwnPropertyDescriptor(navigator,'locks')
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,task:()=>unknown)=>task()}})
 oldAuth=useAuthStore.getState();localStorage.clear();sessionStorage.clear();calls.length=0;unexpected.length=0;mayViewWarehouses=false;denyPreview=false;partial=false
 Object.values(toasts).forEach(x=>x.mockClear());setApiClientBaseURL('http://reserve-authorization.test/api')
 api.defaults.adapter='fetch';api.defaults.env={...oldEnv,fetch:transport}
 useAuthStore.getState().login('synthetic',null,{id:9,username:'synthetic',realName:'合成申请人',roleId:79,roleName:'合成申请',permissions:['sale.order.reserve','sale.order.view']})
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}})
 qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{
 await act(async()=>root.unmount());qc.clear();host.remove();api.defaults.adapter=oldAdapter;api.defaults.env=oldEnv
 useAuthStore.setState(oldAuth);setApiClientBaseURL(oldBase);if(oldLocks)Object.defineProperty(navigator,'locks',oldLocks);else Reflect.deleteProperty(navigator,'locks')
 vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();expect(unexpected).toEqual([])
})
async function mount(){await act(async()=>root.render(<MemoryRouter><QueryClientProvider client={qc}><Dialog open orderId={7} onClose={vi.fn()} onShortage={vi.fn()}/></QueryClientProvider></MemoryRouter>))}
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,15))})}
test.each([false,true])('申请人目录查看权%s：占库仅用本单预览，不请求额外仓库或审批接口',async mayView=>{
 mayViewWarehouses=mayView;await mount()
 await vi.waitFor(async()=>{await flush();expect(document.querySelector('input[type="number"]')).toBeTruthy()})
 await flush();expect(calls).toEqual([{method:'GET',path:'/api/sale/7/reserve-preview'}]);expect(toasts.error).not.toHaveBeenCalled()
 expect(document.body.textContent).toContain('合成商品')
})
test('真实预览权限错误仍显示并封住写入，不能静默吞掉403',async()=>{
 denyPreview=true;await mount();await vi.waitFor(async()=>{await flush();expect(document.body.textContent).toContain('无操作权限')})
 expect(toasts.error).toHaveBeenCalledWith('无操作权限')
 expect(document.querySelector('input[type="number"]')).toBeNull()
 const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('确认占用'))!
 expect(button.disabled).toBe(true);expect(calls).toEqual([{method:'GET',path:'/api/sale/7/reserve-preview'}])
})
test('申请人只从本单预览选择仓库并正常提交，仍不请求目录或审批接口',async()=>{
 await mount();await vi.waitFor(async()=>{await flush();expect(document.querySelector('select')).toBeTruthy()})
 await act(async()=>{const select=document.querySelector<HTMLSelectElement>('select')!;select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}))})
 const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='确认占用（1 项）')!
 expect(button.disabled).toBe(false);await act(async()=>button.click())
 await vi.waitFor(()=>expect(calls.filter(c=>c.method==='POST'),JSON.stringify(toasts.error.mock.calls)).toHaveLength(1))
 await vi.waitFor(()=>expect(toasts.success).toHaveBeenCalledWith('库存已占用'))
 expect(calls.find(c=>c.method==='POST')).toEqual({method:'POST',path:'/api/sale/7/reserve',body:{items:[{id:17,warehouseId:2,warehouseName:'合成第二仓',qty:2}]}})
 expect(calls.filter(c=>c.method==='GET').every(c=>c.path==='/api/sale/7/reserve-preview')).toBe(true)
 expect(toasts.error).not.toHaveBeenCalled()
})
test('已有预占仍锁定原仓，程序变更事件也不能把补占请求换到另一仓',async()=>{
 partial=true;await mount();await vi.waitFor(async()=>{await flush();expect(document.querySelector('select')).toBeTruthy()})
 const select=document.querySelector<HTMLSelectElement>('[role="combobox"]')!;expect(select.disabled).toBe(true)
 await act(async()=>{select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}))})
 const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='确认占用（1 项）')!
 expect(button.disabled).toBe(false);await act(async()=>button.click());await vi.waitFor(()=>expect(toasts.success).toHaveBeenCalledWith('库存已占用'))
 expect(calls.find(c=>c.method==='POST')).toEqual({method:'POST',path:'/api/sale/7/reserve',body:{items:[{id:17,warehouseId:1,warehouseName:'合成仓库',qty:1}]}})
 expect(calls.filter(c=>c.method==='GET').every(c=>c.path==='/api/sale/7/reserve-preview')).toBe(true)
})
