// @vitest-environment jsdom
// Production root controls; reference pickers and business API fixtures. Real HTTP/SQL evidence is separate.
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {webcrypto} from 'node:crypto'
import {setApiClientBaseURL} from '@/api/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {TabPathContext} from '@/components/layout/TabPathContext'
import {useAuthStore} from '@/store/authStore'
import {ApiClientError} from '@/api/client'
import PR from '@/pages/purchase-requisitions/form'
import Plan from '@/pages/procurement/detail'
const m=vi.hoisted(()=>({create:vi.fn(),convert:vi.fn(),receipt:vi.fn()}))
vi.mock('@/api/purchase-requisitions',async original=>({...await original<typeof import('@/api/purchase-requisitions')>(),createRequisitionApi:m.create}))
vi.mock('@/api/procurement',async original=>({...await original<typeof import('@/api/procurement')>(),getPlanApi:async()=>plan,convertPlanApi:m.convert}))
vi.mock('@/api/operation-requests',()=>({getOperationRequestStatusApi:m.receipt}))
vi.mock('@/api/products',async original=>({...await original<typeof import('@/api/products')>(),getProductQtyPoliciesApi:async()=>[]}))
vi.mock('@/api/suppliers',async original=>({...await original<typeof import('@/api/suppliers')>(),getSuppliersActiveApi:async()=>[]}))
vi.mock('@/components/finder',()=>({ProductFinder:(p:{open:boolean;onConfirm:(v:object)=>void})=>p.open?<button onClick={()=>p.onConfirm({id:11,code:'SYNTHETIC',name:'合成商品',unit:'个'})}>选择合成商品</button>:null,SupplierFinder:()=>null}))
vi.mock('@/components/shared/WarehouseSelect',()=>({WarehouseSelect:(p:{disabled?:boolean;onChange:(id:number,name:string)=>void})=><button disabled={p.disabled} onClick={()=>p.onChange(1,'合成仓')}>选择合成仓</button>}))
const plan={id:7,code:'SYNTHETIC-PLAN',status:1,statusName:'草稿',forecastWindow:30,horizonDays:14,defaultLeadTime:7,itemCount:2,items:[1,2].map(id=>({id,planId:7,productId:10+id,productCode:'SYNTHETIC'+id,productName:'合成商品'+id,warehouseName:'合成仓',warehouseId:1,unit:'个',status:1,statusName:'待处理',adjustedQty:10,suggestedQty:10,supplierId:1,supplierName:'合成供应商',adu:0,forecastDemand:0,safetyStock:10,available:0,inTransit:0,currentSupply:null,supplySnapshot:null}))}
let root:Root,host:HTMLDivElement,qc:QueryClient
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,fn:()=>unknown)=>fn()}});localStorage.clear();setApiClientBaseURL('http://synthetic.invalid/api');Object.values(m).forEach(v=>v.mockReset());useAuthStore.getState().login('synthetic',null,{id:9,username:'synthetic',realName:'合成人员',roleId:1,roleName:'合成'});host=document.createElement('div');document.body.append(host);root=createRoot(host);qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();qc.clear();useAuthStore.getState().logout();localStorage.clear()})
const btn=(s:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===s)!
async function render(path:string,component:React.ReactNode){await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><TabPathContext.Provider value={path}><QueryClientProvider client={qc}><Routes><Route path={path.includes('plans')?'/procurement/plans/:id':'/purchase-requisitions/new'} element={component}/></Routes></QueryClientProvider></TabPathContext.Provider></MemoryRouter>))}
test('PROC06生产新建未知冻结保存/正文',async()=>{m.create.mockRejectedValue(new ApiClientError({message:'本轮未知',status:0}));await render('/purchase-requisitions/new',<PR/>);await act(async()=>{btn('选择合成仓').click();btn('添加商品').click()});await act(async()=>btn('选择合成商品').click());await act(async()=>btn('保存').click());await vi.waitFor(()=>expect(m.create).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(btn('保存').disabled).toBe(true));expect(document.querySelector<HTMLInputElement>('input[type="number"]')!.disabled).toBe(true)})
test('PROC07生产计划原A未知冻结selection',async()=>{m.convert.mockRejectedValue(new ApiClientError({message:'本轮未知',status:0}));await render('/procurement/plans/7',<Plan/>);await vi.waitFor(()=>expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(3));const a=host.querySelector<HTMLInputElement>('input[aria-label="选择 合成商品1 合成仓"]')!;await act(async()=>a.click());await act(async()=>btn('转采购（1 行）').click());await vi.waitFor(()=>expect(m.convert).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(a.disabled).toBe(true));await vi.waitFor(()=>expect(btn('转采购（1 行）').disabled).toBe(true))})

test('只读采购计划没有空白选择列，草稿仍保留真实多选', async () => {
  plan.status = 3
  try {
    await render('/procurement/plans/7', <Plan />)
    await vi.waitFor(() => expect(host.textContent).toContain('SYNTHETIC-PLAN'))
    const caption = host.querySelector('.desktop-page-description')!
    expect(caption.textContent).toContain('预测窗口 30 天')
    expect(caption.textContent).toContain('转换时仍会重新核对')
    expect(host.textContent?.match(/需求与覆盖读取于/g)).toHaveLength(1)
    expect(host.querySelector('thead th')?.textContent).toBe('编码')
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(host.querySelector('tbody td')?.textContent).toBe('SYNTHETIC1')
  } finally { plan.status = 1 }
})
