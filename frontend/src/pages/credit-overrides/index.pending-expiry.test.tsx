// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import api,{getApiClientBaseURL,setApiClientBaseURL} from '@/api/client'
import {useAuthStore} from '@/store/authStore'
import Page from './index'

const rights=vi.hoisted(()=>({apply:true}))
vi.mock('@/hooks/usePermission',()=>({usePermission:()=>({can:(p:string)=>p==='sale.credit.override.view'||p==='sale.credit.override.apply'&&rights.apply})}))
vi.mock('@/lib/toast',()=>({toast:{success:vi.fn(),error:vi.fn(),warning:vi.fn()}}))
const reason='待审批申请已过期：已超过有效截止时间。请按当前销售单重新申请，无需先取消历史申请。'
const expired={id:1,overrideNo:'CO-PENDING-EXPIRED',saleOrderId:11,saleOrderNo:'SO-PENDING-EXPIRED',customerId:7,customerName:'合成客户',currentCustomerName:'当前合成客户',thisAmount:20,currentOrderAmount:22,creditLimit:1,usedCredit:0,overAmount:19,reason:'原申请原因',applicantId:9,applicantName:'合成申请人',status:2,statusName:'已过期',statusTone:'warning',requestValidity:'expired',requestInvalidReason:reason,canReapply:true,canManage:true,canApprove:false,currentTaskId:null,createdAt:'2026-10-20T00:00:00Z'}
let root:Root,host:HTMLDivElement,qc:QueryClient,created=false,oldAuth:ReturnType<typeof useAuthStore.getState>
const writes:Array<{path:string;body:unknown}>=[],unexpected:string[]=[]
const oldAdapter=api.defaults.adapter,oldEnv=api.defaults.env,oldBase=getApiClientBaseURL()
const transport=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const r=input instanceof Request?input:new Request(input,init),path=new URL(r.url).pathname
 let data:unknown
 if(r.method==='GET'&&path==='/api/credit-overrides')data={list:[created?{...expired,id:2,overrideNo:'CO-REAPPLIED',status:1,statusName:'草稿',requestValidity:undefined,requestInvalidReason:null,canReapply:false}:expired],pagination:{page:1,pageSize:200,total:1}}
 else if(r.method==='GET'&&path==='/api/credit-overrides/1')data={...expired,approval:null}
 else if(r.method==='GET'&&path==='/api/finance/accounts/active')data=[]
 else if(r.method==='POST'&&path==='/api/credit-overrides'){writes.push({path,body:JSON.parse(await r.text())});created=true;data={id:2,overrideNo:'CO-REAPPLIED',overAmount:21}}
 else{unexpected.push(`${r.method} ${path}`);throw Error('未登记的过期待审页面请求')}
 return new Response(JSON.stringify({success:true,data}),{status:200,headers:{'Content-Type':'application/json'}})
}
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});oldAuth=useAuthStore.getState();localStorage.clear();sessionStorage.clear()
 created=false;rights.apply=true;writes.length=0;unexpected.length=0;setApiClientBaseURL('http://pending-page.test/api');api.defaults.adapter='fetch';api.defaults.env={...oldEnv,fetch:transport}
 useAuthStore.getState().login('synthetic',null,{id:9,username:'synthetic',realName:'合成申请人',roleId:71,roleName:'合成申请',permissions:['sale.credit.override.view','sale.credit.override.apply']})
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}})
 qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{
 await act(async()=>root.unmount());qc.clear();host.remove();api.defaults.adapter=oldAdapter;api.defaults.env=oldEnv;useAuthStore.setState(oldAuth);setApiClientBaseURL(oldBase)
 vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();expect(unexpected).toEqual([])
})
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,15))})}
async function mount(path='/credit-overrides'){await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={qc}><Page/></QueryClientProvider></MemoryRouter>));await vi.waitFor(async()=>{await flush();expect(host.textContent).toContain('CO-PENDING-EXPIRED')})}
async function click(label:string){const b=[...document.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent?.trim()===label);expect(b,label).toBeTruthy();await act(async()=>b!.click());await flush()}
test.each(['/credit-overrides','/credit-overrides?detailId=1'])('过期待审列表和原单详情都显示过期原因，不能提供审批按钮：%s',async path=>{
 await mount(path);expect(host.textContent).toContain(reason)
 if(!path.includes('detailId'))await click('详情 / 记录')
 await vi.waitFor(async()=>{await flush();expect(document.querySelector('[role="dialog"]')?.textContent).toContain(reason)})
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('已过期')
 expect([...document.querySelectorAll('button')].some(b=>['批准','驳回'].includes(b.textContent?.trim()||''))).toBe(false);expect(writes).toEqual([])
})
test('过期待审直接重申绑定当前订单并保留历史；创建后仍须用户提交',async()=>{
 await mount();await click('重新申请');expect(document.querySelector('[role="dialog"]')?.textContent).toContain('SO-PENDING-EXPIRED')
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('22.00')
 const field=document.querySelector<HTMLTextAreaElement>('#credit-reason')!
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'新的过期待审申请原因');field.dispatchEvent(new Event('input',{bubbles:true}))})
 await click('创建申请');await vi.waitFor(async()=>{await flush();expect(host.textContent).toContain('CO-REAPPLIED')})
 expect(writes).toEqual([{path:'/api/credit-overrides',body:{saleOrderId:11,reason:'新的过期待审申请原因'}}])
 expect([...host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='提交')).toBe(true)
})
test('没有申请权仍能看到过期原因，但不能通过页面重新申请',async()=>{
 rights.apply=false;await mount();expect(host.textContent).toContain(reason)
 expect([...host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='重新申请')).toBe(false);expect(writes).toEqual([])
})
