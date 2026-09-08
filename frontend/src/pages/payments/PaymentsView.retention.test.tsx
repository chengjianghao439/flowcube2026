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

const mocks=vi.hoisted(()=>({ receipts:vi.fn(), statements:vi.fn() }))
vi.mock('@/api/payments',async importOriginal=>({
  ...await importOriginal<typeof import('@/api/payments')>(),
  getPaymentsApi:vi.fn(async()=>({list:[],pagination:{total:0},summary:{}})),
  getReceiptsApi:mocks.receipts,
  getStatementsApi:mocks.statements,
}))
vi.mock('@/components/shared/usePaymentActions',()=>({usePaymentActions:()=>({renderActions:()=>null,dialogs:null})}))
let host:HTMLDivElement,root:Root,client:QueryClient
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  useAuthStore.setState({user:{roleId:1,permissions:[]} as never})
  mocks.receipts.mockReset().mockResolvedValue({list:[],pagination:{total:0}})
  mocks.statements.mockReset().mockResolvedValue({list:[],pagination:{total:0}})
  client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());client.clear();host.remove()})
const settle=()=>new Promise(resolve=>setTimeout(resolve,20))
async function render(monthly:boolean,key='initial') {
  const path=monthly?'/reports/reconciliation/receivable':'/payments/receivable'
  await act(async()=>{root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><TabPathContext.Provider value={path}><div key={key}>{monthly?<ReconciliationView type={2}/>:<PaymentsView type={2}/>}</div></TabPathContext.Provider></QueryClientProvider></MemoryRouter>);await settle()})
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
for(const monthly of [false,true]) test(`${monthly?'月结':'现结'}核销筛选切换保留，关闭大页重开重置`,async()=>{
  await render(monthly)
  expect(mocks.receipts).not.toHaveBeenCalled()
  await click('收款核销',host)
  await queryReceipt()
  expect(mocks.receipts.mock.lastCall?.[0].receiptNo).toBe('RC-KEEP')
  await click(monthly?'汇总对账':'按单登记',host)
  const calls=mocks.receipts.mock.calls.length
  await act(async()=>{await client.invalidateQueries({queryKey:['payment-receipts']});await settle()})
  expect(mocks.receipts.mock.calls.length).toBe(calls)
  await click('收款核销',host)
  expect(host.textContent).toContain('RC-KEEP')
  expect(mocks.receipts.mock.lastCall?.[0].receiptNo).toBe('RC-KEEP')
  await render(monthly,'reopened')
  await click('收款核销',host)
  expect(mocks.receipts.mock.lastCall?.[0].receiptNo).toBeUndefined()
  expect(host.textContent).not.toContain('RC-KEEP')
})
