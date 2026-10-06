// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it } from 'vitest'
import type { AxiosAdapter } from 'axios'
import client, { setApiClientBaseURL } from '@/api/client'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import Page from './index'
const oldAdapter=client.defaults.adapter,oldServer=client.defaults.baseURL
let traceGate:Promise<void>|null=null,traceMismatch=false
let refundAmount='0.0040',voucherId:number|null=null,refundError:string|null='零分投影已核对/无需凭证'
let root:Root,host:HTMLDivElement,qc:QueryClient
const unknown:string[]=[],calls:string[]=[]
const transaction={id:77,accountId:42,accountName:'fixture',direction:1,directionName:'收入',amount:0.004,bizType:6,bizTypeName:'供应商退款',bizId:11,bizNo:'RF11',partyName:'fixture',balanceAfter:0.004,happenedAt:'2026-10-01',operatorName:'fixture'}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});unknown.length=0;calls.length=0;traceGate=null;traceMismatch=false
  transaction.amount=0.004;transaction.balanceAfter=0.004;refundAmount='0.0040';voucherId=null;refundError='零分投影已核对/无需凭证'
  useAuthStore.setState({token:'offline',user:{id:9,username:'fixture',realName:'fixture',roleId:2,roleName:'fixture',permissions:[P.FINANCE_ACCOUNT_VIEW,P.SUPPLIER_REFUND_VIEW,P.PURCHASE_ORDER_VIEW,P.RETURN_ORDER_VIEW,P.PAYMENT_VIEW]}})
  client.defaults.adapter=(async config=>{
    const path=config.url||'';calls.push(path)
    let data:unknown
    if(config.method==='get'&&path==='/finance/accounts/active')data=[]
    else if(config.method==='get'&&path==='/finance/accounts/transactions')data={list:[transaction],pagination:{total:1,page:1,pageSize:20},summary:{inAmount:transaction.amount,outAmount:0}}
    else if(config.method==='get'&&path==='/supplier-refunds/11'){if(traceGate)await traceGate;data={id:11,refund_no:'RF11',status:3,amount:refundAmount,refund_date:'2026-10-01',fund_transaction_id:traceMismatch?78:77,voucher_id:voucherId,voucher_generate_error:refundError}}
    else {unknown.push(config.method+' '+path);throw Error('Unexpected strict offline API '+path)}
    return {status:200,statusText:'OK',headers:{},config,data:{success:true,data}}
  }) satisfies AxiosAdapter
})
afterEach(async()=>{await act(async()=>root.unmount());qc.clear();host.remove();client.defaults.adapter=oldAdapter;setApiClientBaseURL(oldServer);useAuthStore.setState({user:null,token:null});localStorage.clear();expect(unknown).toEqual([])})
async function draw(active=true){await act(async()=>{root.render(<MemoryRouter><QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}><Page/></SectionVisibilityContext.Provider></QueryClientProvider></MemoryRouter>)});await act(async()=>{await new Promise(r=>setTimeout(r,25))})}
it('actual finance row preserves four places for supplier refund positive IN and exact RF trace',async()=>{
  await draw();expect(document.body.textContent).toContain('0.0040')
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='RF11');expect(button).toBeDefined()
  await act(async()=>{button!.click();await new Promise(r=>setTimeout(r,20))})
  await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  expect(calls.filter(p=>p==='/supplier-refunds/11')).toHaveLength(1)
  expect(document.body.textContent).toContain('零分投影已核对/无需凭证')
})
it('without exact refund view permissions no protected RF detail is read',async()=>{
  useAuthStore.setState(s=>({user:{...s.user!,permissions:[P.FINANCE_ACCOUNT_VIEW]}}))
  await draw();expect(document.body.textContent).toContain('RF11')
  expect([...document.querySelectorAll('button')].some(b=>b.textContent==='RF11')).toBe(false)
  expect(calls).not.toContain('/supplier-refunds/11')
})

for(const change of ['serverABA','actorABA','permissionsABA','hiddenBounce'])it('late RF trace does not revive after '+change,async()=>{
  let resolve!:()=>void;traceGate=new Promise<void>(r=>{resolve=r})
  try{
    await draw()
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='RF11')!
    await act(async()=>button.click())
    expect(calls.filter(p=>p==='/supplier-refunds/11')).toHaveLength(1)
    if(change==='hiddenBounce'){await draw(false);await draw(true)}
    else await act(async()=>{
      if(change==='serverABA'){setApiClientBaseURL('/api-other');setApiClientBaseURL(oldServer)}
      if(change==='actorABA'){const user=useAuthStore.getState().user!;useAuthStore.setState({user:{...user,id:10}});useAuthStore.setState({user})}
      if(change==='permissionsABA'){const user=useAuthStore.getState().user!;useAuthStore.setState({user:{...user,permissions:[P.FINANCE_ACCOUNT_VIEW]}});useAuthStore.setState({user})}
    })
    await act(async()=>{resolve();await new Promise(r=>setTimeout(r,25))})
    await act(async()=>{await new Promise(r=>setTimeout(r,25))})
    expect(document.body.textContent).not.toContain('零分投影已核对/无需凭证')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  }finally{resolve()}
})

it('RF trace must match this exact original fund, not merely the refund id',async()=>{
  traceMismatch=true;await draw()
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='RF11')!
  await act(async()=>button.click())
  await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  expect(document.body.textContent).toContain('原退款单与这笔流水不符')
  expect(document.body.textContent).not.toContain('零分投影已核对/无需凭证')
})


it('actual RF generated result uses real voucher ID without a nonexistent timestamp',async()=>{
  transaction.amount=4;transaction.balanceAfter=4;refundAmount='4.0000';voucherId=501;refundError=null
  await draw()
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='RF11')!
  await act(async()=>button.click())
  await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  expect(document.body.textContent).toContain('回款 4.0000')
  expect(document.body.textContent).toContain('凭证已生成')
  expect(document.body.textContent).not.toContain('凭证待核对')
  expect(calls.filter(p=>p==='/supplier-refunds/11')).toHaveLength(1)
})
it('actual RF pending result preserves the stored error without claiming a generated voucher',async()=>{
  transaction.amount=4;transaction.balanceAfter=4;refundAmount='4.0000';voucherId=null;refundError='凭证待生成'
  await draw()
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='RF11')!
  await act(async()=>button.click())
  await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  expect(document.body.textContent).toContain('回款 4.0000')
  expect(document.body.textContent).toContain('凭证待生成')
  expect(document.body.textContent).not.toContain('凭证已生成')
  expect(calls.filter(p=>p==='/supplier-refunds/11')).toHaveLength(1)
})
