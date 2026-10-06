// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it } from 'vitest'
import type { AxiosAdapter } from 'axios'
import client from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import Page from './index'
const oldAdapter=client.defaults.adapter
let root:Root,host:HTMLDivElement,qc:QueryClient
const unknown:string[]=[]
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  host=document.createElement('div');document.body.append(host);root=createRoot(host);unknown.length=0
  qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  useAuthStore.setState({token:'offline',user:{id:9,username:'fixture',realName:'fixture',roleId:2,roleName:'fixture',permissions:[P.ACCOUNTING_VOUCHER_VIEW]}})
  client.defaults.adapter=(async config=>{
    const path=config.url||'';let data:unknown
    if(config.method==='get'&&path==='/accounting/vouchers/reconciliation')data={items:[{name:'原毛额',voucher:100,business:100,diff:0,matched:true}],unpostedLedger:{total:0},supplierRefunds:{cashAmount4:'0.0120',projectedAmount2:'0.00',roundingDifference4:'-0.0120',netPaid4:'99.9880',currentPaid4:'99.9880',paidDifference4:'0.0000',matched:true}}
    else if(config.method==='get'&&(path==='/accounting/vouchers'||/^\/accounting\/vouchers\?/.test(path)))data={list:[],pagination:{total:0,page:1,pageSize:20}}
    else if(config.method==='get'&&path==='/accounting/accounts/flat?onlyLeaf=1&onlyActive=1')data=[]
    else {unknown.push(config.method+' '+path);throw Error('Unexpected strict offline API '+path)}
    return {status:200,statusText:'OK',headers:{},config,data:{success:true,data}}
  }) satisfies AxiosAdapter
})
afterEach(async()=>{await act(async()=>root.unmount());qc.clear();host.remove();client.defaults.adapter=oldAdapter;useAuthStore.setState({user:null,token:null});localStorage.clear();expect(unknown).toEqual([])})
it('actual reconciliation consumer shows real four-place cash, separate projected cents and net paid',async()=>{
  await act(async()=>{root.render(<MemoryRouter><QueryClientProvider client={qc}><Page/></QueryClientProvider></MemoryRouter>)})
  await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  expect(document.body.textContent).toContain('供应商退款')
  expect(document.body.textContent).toContain('0.0120');expect(document.body.textContent).toContain('-0.0120')
  expect(document.body.textContent).toContain('99.9880');expect(document.body.textContent).toContain('分位投影')
})
