// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ReceiptDetailDialog } from './ReceiptDetailDialog'
import { StatementDetailDialog } from './StatementDetailDialog'
import PaymentsView from '@/pages/payments/PaymentsView'
import PartyLedgerPage from '@/pages/payments/party-ledger'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'

const mocks = vi.hoisted(() => ({ receipt:vi.fn(), statement:vi.fn(), payments:vi.fn(), ledger:vi.fn() }))
vi.mock('@/api/payments', async original => ({
  ...await original<typeof import('@/api/payments')>(),
  getReceiptDetailApi:mocks.receipt, getStatementDetailApi:mocks.statement, getPaymentsApi:mocks.payments,
  getReceiptsApi:vi.fn(async()=>({list:[],pagination:{total:0}})), getDebitAccountOptionsApi:vi.fn(async()=>[]),
}))
vi.mock('@/api/party-ledger',()=>({getPartyLedger:mocks.ledger}))
vi.mock('@/api/finance',()=>({getActiveAccountsApi:vi.fn(async()=>[])}))
vi.mock('@/api/customers',()=>({getCustomersApi:vi.fn(async()=>({list:[],pagination:{total:0}}))}))
vi.mock('@/api/suppliers',()=>({getSuppliersApi:vi.fn(async()=>({list:[],pagination:{total:0}}))}))
vi.mock('@/components/shared/usePaymentActions',()=>({usePaymentActions:()=>({renderActions:()=>null,dialogs:null})}))
let host:HTMLDivElement, root:Root, client:QueryClient
const close = vi.fn()
const settle = () => new Promise(resolve=>setTimeout(resolve,20))
const receipt = (type:1|2=2,id=7) => ({id,type,receiptNo:'RC-7',partyId:42,partyName:'同名单位',amount:100,settledAmount:30,balance:70,
  settlements:[{entryId:1,recordId:9,orderId:81,type,orderNo:'原业务单',amount:30,orderTotal:200,orderBalance:150},{entryId:2,recordId:10,orderId:null,type,orderNo:'历史手工',amount:0,orderTotal:0,orderBalance:0}]})
function Location(){const location=useLocation();return <output data-location>{location.pathname}</output>}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  useAuthStore.setState({user:{roleId:5,permissions:['payment.view','sale.order.view','purchase.order.view']} as never})
  useWorkspaceStore.setState({tabs:[],activeKey:'/payments/receivable'})
  close.mockReset();mocks.receipt.mockReset().mockResolvedValue(receipt());mocks.statement.mockReset();mocks.payments.mockReset();mocks.ledger.mockReset()
  client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());client.clear();host.remove();onlineManager.setOnline(true)})
async function render(node:React.ReactNode,path='/payments/receivable') {
  await act(async()=>{root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><TabPathContext.Provider value={path}>{node}<Location/></TabPathContext.Provider></QueryClientProvider></MemoryRouter>);await settle()})
  await act(async()=>{await settle()})
}
function button(text:string){return [...document.querySelectorAll('button')].find(b=>b.textContent===text)}
async function click(text:string){expect(button(text),text).toBeTruthy();await act(async()=>{button(text)!.click();await settle()})}
for(const type of [1,2] as const) test(`汇款${type}真实单位及原单导航关闭详情`,async()=>{
  mocks.receipt.mockResolvedValue(receipt(type))
  await render(<ReceiptDetailDialog open receiptId={7} type={type} onClose={close}/> )
  expect(document.body.textContent).toContain('这笔款')
  expect(document.body.textContent).toContain('当前订单账款')
  expect(document.body.textContent).toContain('无法定位原单')
  await click('往来明细')
  expect(close).toHaveBeenCalledTimes(1)
  expect(host.querySelector('output')?.textContent).toBe(`/payments/ledger/${type===2?'customer':'supplier'}/42`)
  expect(useWorkspaceStore.getState().tabs.at(-1)?.path).toBe(`/payments/ledger/${type===2?'customer':'supplier'}/42`)
})
test('汇款核销行按真实ID和类型打开原单，先关闭只读详情',async()=>{
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  await click('原业务单');expect(close).toHaveBeenCalledOnce();expect(host.querySelector('output')?.textContent).toBe('/sale/81')
})
for(const patch of [{partyId:null},{partyId:0},{partyId:1.5},{partyId:Number.MAX_SAFE_INTEGER+1},{id:8},{type:1}] ) test(`汇款身份不可靠不能跳往来 ${JSON.stringify(patch)}`,async()=>{
  mocks.receipt.mockResolvedValue({...receipt(),...patch});await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(button('往来明细')).toBeUndefined()
})
test('无目标权限保留单号文本，隐藏导航',async()=>{
  useAuthStore.setState({user:{roleId:5,permissions:[]} as never})
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(document.body.textContent).toContain('原业务单');expect(button('原业务单')).toBeUndefined();expect(button('往来明细')).toBeUndefined()
})
test('缓存重读、暂停、失败及切换到B失败均不能用旧cache导航',async()=>{
  client.setQueryData(['payment-receipt-detail',7],receipt())
  client.setQueryData(['payment-receipt-detail',7,2],receipt())
  let reject!:(reason:Error)=>void
  mocks.receipt.mockImplementation(()=>new Promise((_,r)=>{reject=r}))
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(button('往来明细')).toBeUndefined();expect(button('原业务单')).toBeUndefined()
  await act(async()=>{reject(new Error('读取失败'));await settle()})
  expect(document.body.textContent).toContain('加载失败');expect(button('往来明细')).toBeUndefined()
  mocks.receipt.mockRejectedValue(new Error('B失败'))
  await render(<ReceiptDetailDialog open receiptId={8} type={2} onClose={close}/>)
  expect(button('往来明细')).toBeUndefined();expect(button('原业务单')).toBeUndefined()
  onlineManager.setOnline(false)
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(button('往来明细')).toBeUndefined()
})
test('关闭或工作区非当前时不暴露导航',async()=>{
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  await render(<ReceiptDetailDialog open={false} receiptId={7} type={2} onClose={close}/>)
  expect(button('往来明细')).toBeUndefined()
  await render(<TabPathContext.Provider value="/payments/payable"><ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/></TabPathContext.Provider>)
  expect(button('往来明细')).toBeUndefined()
})
for(const type of [1,2] as const) test(`对账明细${type}真实原单导航`,async()=>{
  mocks.statement.mockResolvedValue({id:3,type,statementNo:'ST-3',partyName:'同名单位',status:2,items:[{recordId:9,orderId:81,type,orderNo:'对账原单',totalAmount:100,paidAmount:30,balance:70}]})
  await render(<StatementDetailDialog open statementId={3} type={type} onClose={close}/>)
  await click('对账原单');expect(close).toHaveBeenCalledOnce();expect(host.querySelector('output')?.textContent).toBe(`/${type===2?'sale':'purchase'}/81`)
})
for(const type of [1,2] as const) test(`现结${type}按单列表原单导航`,async()=>{
  mocks.payments.mockResolvedValue({list:[{id:9,type,orderId:81,orderNo:'现结原单',totalAmount:100,paidAmount:30,balance:70,status:2}],pagination:{total:1}})
  await render(<PaymentsView type={type}/>)
  await click('现结原单');expect(host.querySelector('output')?.textContent).toBe(`/${type===2?'sale':'purchase'}/81`)
})
test('往来明细的汇款核销原单关闭来源portal',async()=>{
  const path='/payments/ledger/customer/42';useWorkspaceStore.setState({activeKey:path})
  mocks.ledger.mockResolvedValue({party:{name:'单位'},summary:{},list:[{id:1,receiptId:7,documentNo:'RC-7'}]})
  await render(<PartyLedgerPage/>,path);await click('收付款');await act(async()=>{await settle()});await click('原业务单')
  expect(host.querySelector('output')?.textContent).toBe('/sale/81');expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('暂停的旧缓存明确显示暂停且不提供来源导航',async()=>{
  client.setQueryData(['payment-receipt-detail',7,2],receipt())
  onlineManager.setOnline(false)
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(document.body.textContent).toContain('网络暂停')
  expect(button('往来明细')).toBeUndefined();expect(button('原业务单')).toBeUndefined()
  expect(mocks.receipt).not.toHaveBeenCalled()
})
test('多单部分核销可分别导航真实来源，不把余额写成单位欠款',async()=>{
  const data=receipt();data.settlements[1]={...data.settlements[0],entryId:2,orderId:82,orderNo:'另一原单',amount:10,orderBalance:55}
  mocks.receipt.mockResolvedValue(data)
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(button('原业务单')).toBeTruthy();expect(button('另一原单')).toBeTruthy()
  await click('另一原单');expect(host.querySelector('output')?.textContent).toBe('/sale/82')
})
test('未核销汇款仍可用可靠单位查看往来，空归属保留说明',async()=>{
  mocks.receipt.mockResolvedValue({...receipt(),settledAmount:0,balance:100,settlements:[]})
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(document.body.textContent).toContain('这笔款尚未核销任何订单');expect(button('往来明细')).toBeTruthy()
  mocks.receipt.mockResolvedValue({...receipt(2,8),partyId:null,settlements:[]})
  await render(<ReceiptDetailDialog open receiptId={8} type={2} onClose={close}/>)
  expect(document.body.textContent).toContain('单位归属待核查');expect(button('往来明细')).toBeUndefined()
})
test('有往来权限但无销售查看权限时仍保留单号文本',async()=>{
  useAuthStore.setState({user:{roleId:5,permissions:['payment.view']} as never})
  await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(button('往来明细')).toBeTruthy();expect(button('原业务单')).toBeUndefined()
  expect(document.body.textContent).toContain('原业务单')
})
for(const patch of [{orderId:0},{orderId:1.5},{orderId:Number.MAX_SAFE_INTEGER+1},{type:1}]) test(`核销来源无效或类型错位不导航 ${JSON.stringify(patch)}`,async()=>{
  const data=receipt();data.settlements[0]={...data.settlements[0],...patch} as typeof data.settlements[0]
  mocks.receipt.mockResolvedValue(data);await render(<ReceiptDetailDialog open receiptId={7} type={2} onClose={close}/>)
  expect(button('原业务单')).toBeUndefined()
})
