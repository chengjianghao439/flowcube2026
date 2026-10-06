// @vitest-environment jsdom
import type { InternalAxiosRequestConfig } from 'axios'
import { act, createElement } from 'react'
import { AxiosError } from 'axios'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { AppToast } from '@/components/shared/AppToast'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import PurchaseReturnFormPage from './index'

const confirmCapture=vi.hoisted(()=>({confirm:null as null|(()=>void)}))
vi.mock('@/components/shared/ConfirmDialog',async original=>{const actual=await original<typeof import('@/components/shared/ConfirmDialog')>();return {...actual,ConfirmDialog:(props:import('react').ComponentProps<typeof actual.ConfirmDialog>)=>{if(props.open&&props.title==='确认采购退货单')confirmCapture.confirm=props.onConfirm;return createElement(actual.ConfirmDialog,props)}}})
const originalAdapter = apiClient.defaults.adapter
const originalBaseURL = apiClient.defaults.baseURL
const path = '/returns/purchase/11'
const unknownRequests: string[] = []
const originalAuth = useAuthStore.getState()
const originalWorkspace = useWorkspaceStore.getState()
const detail = {
  id: 11, returnNo: 'PR11', supplierId: 3, supplierName: '夹具供应商', warehouseId: 8, warehouseName: '夹具仓',
  purchaseOrderId: 10, purchaseOrderNo: 'PO10', status: 2, statusName: '退货中', totalAmount: 8,
  operatorName: '夹具经办人', createdAt: '2026-10-04 10:00:00',
  items: [{ id: 101, productId: 1, productCode: 'P1', productName: '原退货商品', unit: '个', quantity: 2, unitPrice: 4, amount: 8 }],
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  unknownRequests.length = 0
  sessionStorage.clear(); localStorage.clear()
  useAuthStore.getState().login('fixture', null, { id: 5, username: 'fixture', realName: '夹具', roleId: 1, roleName: '夹具角色', permissions: ['*'] })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  useWorkspaceStore.getState().addTab({ ...buildWorkspaceTabRegistrationFromPath(path), title: '采购退货单' })
  apiClient.defaults.baseURL = 'https://fixture.example.test/api'
})
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter; apiClient.defaults.baseURL = originalBaseURL
  useAuthStore.setState(originalAuth); useWorkspaceStore.setState(originalWorkspace)
  sessionStorage.clear(); localStorage.clear()
  // Axios/React Query may catch a rejection; unknown endpoints must still fail the test.
  expect(unknownRequests).toEqual([])
})
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }

test.each([
  { label: 'physical return pending', result: { pendingCancel: true, tasks: [{ id: 21, taskNo: 'WT21' }] }, expectedStatus: 2, message: '取消处理中，请先按原任务完成实物归还，完成后再次确认取消' },
  { label: 'legacy completed null result', result: null, expectedStatus: 4, message: '已取消' },
])('real purchase-return cancel confirmation shows $label and sends original ID once', async ({ result, expectedStatus, message }) => {
  const posts: InternalAxiosRequestConfig[] = []
  apiClient.defaults.adapter = async config => {
    if (config.method === 'get' && config.url === '/returns/purchase/11') return {
      config, data: { success: true, data: { ...detail, status: posts.length ? expectedStatus : 2 } }, status: 200, statusText: 'OK', headers: {},
    }
    if (config.method === 'post' && config.url === '/returns/purchase/11/cancel') {
      posts.push(config)
      return { config, data: { success: true, data: result }, status: result ? 202 : 200, statusText: 'OK', headers: {} }
    }
    unknownRequests.push(`${config.method} ${config.url}`)
    throw Error(`Unexpected adapter request: ${config.method} ${config.url}`)
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><AppToast /><TabPathContext.Provider value={path}><PurchaseReturnFormPage /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>))
    await flush()
    expect(host.textContent).toContain('原退货商品')
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '取消')!.click())
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('取消采购退货单')
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === '确认取消')!.click())
    await flush()
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/returns/purchase/11/cancel')
    expect(posts[0].baseURL).toBe('https://fixture.example.test/api')
    const messages = [...document.querySelectorAll('.fc-toast')].map(toast => toast.textContent)
    expect(messages.some(value => value?.includes(message))).toBe(true)
    if (result) {
      expect(messages.some(value => value?.includes('已取消'))).toBe(false)
      expect([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '取消')).toBe(true)
    } else {
      expect([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '取消')).toBe(false)
    }
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  } finally {
    await act(async () => root.unmount()); host.remove(); cache.clear()
  }
})

test.each([
 {label:'exact',code:'PURCHASE_RETURN_REFUND_REQUIRED',data:{purchaseReturnId:11,purchaseOrderId:10},linked:true,expected:true},
 {label:'wrong PR',code:'PURCHASE_RETURN_REFUND_REQUIRED',data:{purchaseReturnId:12,purchaseOrderId:10},linked:true,expected:false},
 {label:'wrong PO',code:'PURCHASE_RETURN_REFUND_REQUIRED',data:{purchaseReturnId:11,purchaseOrderId:20},linked:true,expected:false},
 {label:'message only',code:'CONFLICT',data:null,linked:true,expected:false},
 {label:'unlinked legacy',code:'PURCHASE_RETURN_REFUND_REQUIRED',data:{purchaseReturnId:11,purchaseOrderId:10},linked:false,expected:false},
])('actual PR negative-headroom error $label shows accurate explicit RF source only by structured identity',async v=>{
 const errorText='已付金额超过退货后应付，请先核对供应商退款';const posts:InternalAxiosRequestConfig[]=[];
 apiClient.defaults.adapter=async config=>{
  if(config.method==='get'&&config.url==='/returns/purchase/11')return {config,data:{success:true,data:{...detail,status:1,purchaseOrderId:v.linked?10:null}},status:200,statusText:'OK',headers:{}};
  if(config.method==='post'&&config.url==='/returns/purchase/11/confirm'){expect(config.baseURL).toBe('https://fixture.example.test/api');expect(config.automaticReplay).toBe(false);expect(config._erpApiFallbackTried).toBe(true);posts.push(config);throw new AxiosError(errorText,'ERR_BAD_REQUEST',config,undefined,{config,data:{success:false,message:errorText,code:v.code,data:v.data},status:409,statusText:'Conflict',headers:{}})}
  unknownRequests.push(`${config.method} ${config.url}`);throw Error('unknown PR refund adapter')
 };
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
 try{await act(async()=>root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><TabPathContext.Provider value={path}><PurchaseReturnFormPage/></TabPathContext.Provider></MemoryRouter></QueryClientProvider>));await flush();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='确认（派发到 PDA）')!.click());
 await act(async()=>{try{await confirmCapture.confirm!()}catch{ /* Pre-fix rejection is asserted by the missing actual error panel below. */ }});await flush();
 expect(posts).toHaveLength(1);const panel=host.querySelector('[data-pr-refund-error]');expect(panel).toBeTruthy();expect(panel!.textContent).toContain(errorText);expect(!!panel!.querySelector('button')).toBe(v.expected);expect(useWorkspaceStore.getState().tabs.some(t=>t.path.includes('/supplier-refunds/new'))).toBe(false);
 if(v.expected){await act(async()=>panel!.querySelector('button')!.click());expect(useWorkspaceStore.getState().tabs.find(t=>t.path.includes('/supplier-refunds/new'))?.path).toBe('/supplier-refunds/new?purchaseReturnId=11')}
 }finally{await act(async()=>root.unmount());host.remove();qc.clear()}
})
test.each(['server','hidden'])('actual PR late409 after %s change cannot show refund source or clear original confirmation',async change=>{
 let reject!:(e:unknown)=>void;apiClient.defaults.adapter=async config=>{
 if(config.method==='get'&&config.url==='/returns/purchase/11')return {config,data:{success:true,data:{...detail,status:1}},status:200,statusText:'OK',headers:{}};
 if(config.method==='post'&&config.url==='/returns/purchase/11/confirm')return new Promise((_r,j)=>{reject=_e=>j(new AxiosError('先处理退款','ERR_BAD_REQUEST',config,undefined,{config,data:{message:'先处理退款',code:'PURCHASE_RETURN_REFUND_REQUIRED',data:{purchaseReturnId:11,purchaseOrderId:10}},status:409,statusText:'Conflict',headers:{}}))});
 unknownRequests.push(`${config.method} ${config.url}`);throw Error('unknown late PR adapter')};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const draw=async(active:boolean)=>{await act(async()=>root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><TabPathContext.Provider value={path}><SectionVisibilityContext.Provider value={active}><PurchaseReturnFormPage/></SectionVisibilityContext.Provider></TabPathContext.Provider></MemoryRouter></QueryClientProvider>))};
 try{await draw(true);await flush();await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='确认（派发到 PDA）')!.click());let pending:Promise<unknown>;await act(async()=>{pending=Promise.resolve(confirmCapture.confirm!()).catch(()=>{})});
 if(change==='server'){await act(async()=>{setApiClientBaseURL('/b');setApiClientBaseURL('https://fixture.example.test/api')})}else{await draw(false);await draw(true)}
 await act(async()=>{reject(null);await pending});await flush();expect(host.querySelector('[data-pr-refund-error]')).toBeNull();expect(document.body.textContent).toContain('确认采购退货单');expect(useWorkspaceStore.getState().tabs.some(t=>t.path.includes('/supplier-refunds/new'))).toBe(false)
 }finally{await act(async()=>root.unmount());host.remove();qc.clear()}
})

test('only legitimate PR permissions retain actual confirmation dispatch without RF VIEW or CREATE buttons',async()=>{
 useAuthStore.getState().updateUser({roleId:2,permissions:['return.order.view','return.order.confirm']});const posts:InternalAxiosRequestConfig[]=[];
 apiClient.defaults.adapter=async config=>{
 if(config.method==='get'&&config.url==='/returns/purchase/11')return {config,data:{success:true,data:{...detail,status:1}},status:200,statusText:'OK',headers:{}};
 if(config.method==='post'&&config.url==='/returns/purchase/11/confirm'){posts.push(config);expect(config.baseURL).toBe('https://fixture.example.test/api');expect(config.automaticReplay).toBe(false);expect(config._erpApiFallbackTried).toBe(true);throw new AxiosError('先核对原退款','ERR_BAD_REQUEST',config,undefined,{config,data:{message:'先核对原退款',code:'PURCHASE_RETURN_REFUND_REQUIRED',data:{purchaseReturnId:11,purchaseOrderId:10}},status:409,statusText:'Conflict',headers:{}})}
 unknownRequests.push(`${config.method} ${config.url}`);throw Error('unknown PR permissions adapter')};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),qc=new QueryClient({defaultOptions:{queries:{retry:false}}});try{
 await act(async()=>root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><TabPathContext.Provider value={path}><PurchaseReturnFormPage/></TabPathContext.Provider></MemoryRouter></QueryClientProvider>));await flush();await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='确认（派发到 PDA）')!.click());await act(async()=>confirmCapture.confirm!());await flush();expect(posts).toHaveLength(1);expect(host.querySelector('[data-pr-refund-error]')?.textContent).toContain('先核对原退款');expect(document.body.textContent).not.toContain('发起供应商退款')
 }finally{await act(async()=>root.unmount());host.remove();qc.clear()}
})
