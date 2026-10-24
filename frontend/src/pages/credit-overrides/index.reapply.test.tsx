// @vitest-environment jsdom
// Real page/hooks/API, closed synthetic HTTP allowlist. No external network.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './index'
import api, { getApiClientBaseURL, setApiClientBaseURL } from '@/api/client'

const rights = vi.hoisted(() => ({ apply: true, approve: false }))
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => code === 'sale.credit.override.apply' ? rights.apply : code === 'sale.credit.override.approve' && rights.approve }) }))
vi.mock('@/lib/toast', () => ({ toast: toasts }))
let root: Root, host: HTMLDivElement, cache: QueryClient, currentSearch = ''
let created = false, submitted = false, failCreate = false, pending = false, why = '销售单内容已变更'
const writes: Array<{ path: string; body: Record<string, unknown> }> = [], unexpected: string[] = []
const oldAdapter = api.defaults.adapter, oldEnv = api.defaults.env, oldBase = getApiClientBaseURL()
const original = { id:1,overrideNo:'CO-OLD',saleOrderId:111,saleOrderNo:'SO-PARTIAL',customerId:22,customerName:'合成部分占库客户',thisAmount:30,currentOrderAmount:33,currentCustomerName:'当前客户',creditLimit:1,usedCredit:0,overAmount:29,reason:'原申请原因',applicantId:7,applicantName:'合成申请人',status:3,statusName:'已批准（已失效）',statusTone:'success',createdAt:'2026-10-19T01:00:00Z',canReapply:true,canManage:true,approvalValidity:'invalid' }
const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init)
  const url = new URL(request.url), path = url.pathname
  let data: unknown, responseStatus = 200
  if(request.method === 'GET' && path === '/api/credit-overrides') {
    data = { list:[pending ? {...original,status:2,statusName:'待审批',canReapply:false,canApprove:true,currentTaskId:77,approvalValidity:undefined} : created ? {...original,id:2,overrideNo:'CO-NEW',reason:'新的审批原因',status:submitted?2:1,statusName:submitted?'待审批':'草稿',approvalValidity:undefined,canReapply:false} : {...original,approvalInvalidReason:`原批准已失效：${why}。`}],pagination:{page:1,pageSize:200,total:1} }
  } else if(request.method === 'GET' && path === '/api/finance/accounts/active') data = []
  else if(request.method === 'POST' && ['/api/credit-overrides','/api/credit-overrides/2/submit'].includes(path)) {
    const text = await request.clone().text(), body = text ? JSON.parse(text) : {}
    writes.push({path,body})
    if(path === '/api/credit-overrides') { responseStatus=failCreate?409:201;created=!failCreate;data={id:2,overrideNo:'CO-NEW',overAmount:29} }
    else { submitted=true;data={id:2,status:2} }
  } else { unexpected.push(`${request.method} ${path}`);throw Error('重新申请回归禁止未登记端点') }
  return new Response(JSON.stringify(failCreate && request.method==='POST' ? {success:false,code:'CREDIT_OVERRIDE_DUPLICATE',message:'已有待审批申请，请查看进度',data:null} : {success:true,data}),{status:responseStatus,headers:{'Content-Type':'application/json'}})
}
function LocationProbe() { currentSearch = useLocation().search;return null }
const flush = async () => { await act(async()=>{await new Promise(r=>setTimeout(r,20))}) }
async function click(label: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(n=>n.textContent?.trim()===label)
  expect(button,label).toBeTruthy();await act(async()=>button!.click());await flush()
}
async function mount() {
  await act(async()=>root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/credit-overrides?status=3&startDate=2026-10-01']}><LocationProbe/><Page/></MemoryRouter></QueryClientProvider>))
  await vi.waitFor(async()=>{await flush();expect(host.textContent).toContain('CO-OLD')})
}
async function reason() {
  const node=document.querySelector<HTMLTextAreaElement>('#credit-reason')!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(node,'新的审批原因');node.dispatchEvent(new Event('input',{bubbles:true}))})
  return node
}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  localStorage.clear();writes.length=0;unexpected.length=0;created=false;submitted=false;failCreate=false;pending=false;rights.apply=true;rights.approve=false;why='销售单内容已变更'
  Object.values(toasts).forEach(m=>m.mockClear())
  setApiClientBaseURL('http://credit-reapply.test/api');api.defaults.adapter='fetch';api.defaults.env={...oldEnv,fetch:transport}
  vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}})
  cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{
  await act(async()=>root.unmount());cache.clear();host.remove();api.defaults.adapter=oldAdapter;api.defaults.env=oldEnv;setApiClientBaseURL(oldBase)
  vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();expect(unexpected).toEqual([])
})

test.each(['销售单内容已变更','已超过有效截止时间','缺少原始内容证明'])('显示失效原因%s；部分占库原单直接重申，历史不取消，新单仍由用户提交',async message=>{
  why=message;await mount();expect(host.textContent).toContain(`原批准已失效：${message}。`)
  expect(host.querySelector('.desktop-page-description')?.textContent).toBe('金额为申请时的授信额度')
  expect(host.textContent?.match(/金额为申请时的授信额度/g)).toHaveLength(1)
  await click('重新申请')
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.querySelector('.fc-dialog-caption')?.textContent).toContain('提交后系统会校验该客户授信是否超限')
  expect(dialog.querySelector('.fc-dialog-caption')?.textContent).toContain('旧申请与审批记录保留')
  expect(dialog.textContent?.match(/提交后系统会校验该客户授信是否超限/g)).toHaveLength(1)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('SO-PARTIAL')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前客户')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('33.00')
  await reason();await click('创建申请')
  await vi.waitFor(()=>expect(host.textContent).toContain('CO-NEW'))
  expect(writes).toEqual([{path:'/api/credit-overrides',body:{saleOrderId:111,reason:'新的审批原因'}}])
  expect(new URLSearchParams(currentSearch).get('status')).toBe('1')
  expect(new URLSearchParams(currentSearch).get('keyword')).toBe('CO-NEW')
  expect(new URLSearchParams(currentSearch).has('startDate')).toBe(false)
  await click('提交')
  await vi.waitFor(()=>expect(writes.map(r=>r.path)).toEqual(['/api/credit-overrides','/api/credit-overrides/2/submit']))
})

test('仅有审批或查看资格不能获得重新申请按钮',async()=>{
  rights.apply=false;rights.approve=true;await mount();expect(host.textContent).toContain('已失效')
  expect([...host.querySelectorAll('button')].some(n=>n.textContent==='重新申请')).toBe(false)
})

test.each([[true,false],[false,true]])('同步后的待审按钮分权：申请权%s，独立审批权%s',async(apply,approve)=>{
  rights.apply=apply;rights.approve=approve;pending=true;await mount()
  const labels=[...host.querySelectorAll('button')].map(n=>n.textContent?.trim())
  expect(labels.includes('批准')).toBe(approve);expect(labels.includes('驳回')).toBe(approve)
  expect(labels.includes('发起申请')).toBe(apply);expect(labels.includes('重新申请')).toBe(false)
  expect(writes).toHaveLength(0)
})

test('并发产生待审批申请时显示服务端原因，保留本次填写且不取消历史单',async()=>{
  failCreate=true;await mount();await click('重新申请');const node=await reason();await click('创建申请')
  await vi.waitFor(()=>expect(toasts.error).toHaveBeenCalledWith('已有待审批申请，请查看进度'))
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();expect(node.value).toBe('新的审批原因')
  expect(writes).toHaveLength(1);expect(writes[0].path).toBe('/api/credit-overrides')
})
