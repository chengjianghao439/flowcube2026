// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PaymentsView from './PaymentsView'
import ReconciliationView from '../reports/ReconciliationView'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import api from '@/api/client'
import type { InternalAxiosRequestConfig } from 'axios'

const mocks=vi.hoisted(()=>({ receipts:vi.fn(), statements:vi.fn() }))
vi.mock('@/api/payments',async importOriginal=>({
  ...await importOriginal<typeof import('@/api/payments')>(),
  getPaymentsApi:vi.fn(async()=>({list:[],pagination:{total:0},summary:{}})),
  getReceiptsApi:mocks.receipts,
  getStatementsApi:mocks.statements,
}))
vi.mock('@/components/shared/usePaymentActions',()=>({usePaymentActions:()=>({renderActions:()=>null,dialogs:null})}))
// 月结切到全部账款可能读取原报表；邻接保留测试也必须只使用离线API边界。
vi.mock('@/api/reports',()=>({getReconciliationApi:vi.fn(async()=>({list:[],pagination:{total:0},summary:{}}))}))
let host:HTMLDivElement,root:Root,client:QueryClient
const originalAdapter=api.defaults.adapter
const blockedTransport=vi.fn(async(config:InternalAxiosRequestConfig)=>{throw new Error(`保留测试未允许网络端点：${config.url}`)})
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  useAuthStore.setState({user:{roleId:1,permissions:[]} as never})
  mocks.receipts.mockReset().mockResolvedValue({list:[],pagination:{total:0}})
  mocks.statements.mockReset().mockResolvedValue({list:[],pagination:{total:0}})
  blockedTransport.mockClear();api.defaults.adapter=blockedTransport
  client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());client.clear();host.remove();api.defaults.adapter=originalAdapter;expect(blockedTransport).not.toHaveBeenCalled()})
const settle=()=>new Promise(resolve=>setTimeout(resolve,20))
async function render(monthly:boolean,key='initial',type:1|2=2) {
  const path=monthly?'/reports/reconciliation/receivable':`/payments/${type===1?'payable':'receivable'}`
  await act(async()=>{root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><TabPathContext.Provider value={path}><div key={key}>{monthly?<ReconciliationView type={type}/>:<PaymentsView type={type}/>}</div></TabPathContext.Provider></QueryClientProvider></MemoryRouter>);await settle()})
}
async function click(text:string,scope:ParentNode=document) {
  const button=[...scope.querySelectorAll('button')].find(b=>b.textContent===text)!
  expect(button,text).toBeTruthy()
  await act(async()=>{button.click();await settle()})
}
async function queryReceipt() {
  await click('查询',host)
  const dialog=document.querySelector('[role="dialog"]')!
  const input=dialog.querySelector('input')!
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'RC-KEEP')
    input.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await click('查询',dialog)
}
for(const [monthly,type] of [[false,1],[false,2],[true,2]] as const) test(`${monthly?'月结':'现结'}${type===1?'供应商':'客户'}核销当前语义与筛选切换保留，关闭大页重开重置`,async()=>{
  const receiptLabel=`${type===1?'付款':'收款'}核销`
  const assertCurrent=(label:string)=>{
    if(monthly)return
    const nav=host.querySelector(`nav[aria-label="现结${type===1?'供应商':'客户'}账款登记方式"]`)!
    expect(nav).toBeTruthy()
    expect(nav.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
    expect(nav.querySelector('[aria-current="true"]')?.textContent).toBe(label)
  }
  await render(monthly,'initial',type)
  assertCurrent('按单登记')
  expect(mocks.receipts).not.toHaveBeenCalled()
  await click(receiptLabel,host)
  assertCurrent(receiptLabel)
  await queryReceipt()
  expect(mocks.receipts.mock.lastCall?.[0].receiptNo).toBe('RC-KEEP')
  await click(monthly?'汇总对账':'按单登记',host)
  assertCurrent('按单登记')
  const calls=mocks.receipts.mock.calls.length
  await act(async()=>{await client.invalidateQueries({queryKey:['payment-receipts']});await settle()})
  expect(mocks.receipts.mock.calls.length).toBe(calls)
  await click(receiptLabel,host)
  assertCurrent(receiptLabel)
  expect(host.textContent).toContain('RC-KEEP')
  expect(mocks.receipts.mock.lastCall?.[0].receiptNo).toBe('RC-KEEP')
  await render(monthly,'reopened',type)
  assertCurrent('按单登记')
  await click(receiptLabel,host)
  assertCurrent(receiptLabel)
  expect(mocks.receipts.mock.lastCall?.[0].receiptNo).toBeUndefined()
  expect(host.textContent).not.toContain('RC-KEEP')
})
