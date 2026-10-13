// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import CarrierAccountsPage from './index'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
const api=vi.hoisted(()=>({getCarriersApi:vi.fn(),getCarrierAccountBindingApi:vi.fn(),saveCarrierAccountBindingApi:vi.fn(),createCarrierAccountApi:vi.fn()}))
vi.mock('@/api/carriers',()=>api)
vi.mock('@/hooks/usePermission',()=>({usePermission:()=>({can:()=>true})}))
vi.mock('@/router/routeRegistry',async original=>({...await original<typeof import('@/router/routeRegistry')>(),resolveRouteComponent:(path:string)=>path==='/carrier-accounts'?CarrierAccountsPage:null}))
let navigate:NavigateFunction
function Harness(){const location=useLocation();navigate=useNavigate();return <><output data-location>{location.pathname+location.search}</output><KeepAliveOutlet/></>}
test('真实账号页手选账号和搜索在离开再返回后保留，显式指定其他账号仍生效',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});useWorkspaceStore.setState({tabs:[HOME_TAB],activeKey:HOME_TAB.key})
 api.getCarriersApi.mockResolvedValue({list:[7,8].map(id=>({id,name:'合成账号'+id,code:'CAR'+id,isActive:true,platformCode:'sf',monthlyAccount:'M'+id,waybillEnabled:false})),pagination:{page:1,pageSize:100,total:2}})
 api.getCarrierAccountBindingApi.mockImplementation(async(id:number)=>({carrierId:id,carrierName:'合成账号'+id,platformCode:'sf',monthlyAccount:'M'+id,revision:String(id).repeat(64),products:[],shippingProduct:'',shippingDeliveryType:'',enabled:false,active:true}))
 const cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,25))})
 try{
 await act(async()=>root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/carrier-accounts?carrierId=7']}><Harness/></MemoryRouter></QueryClientProvider>));await settle()
 const button=[...host.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find(b=>b.textContent?.includes('合成账号8'))!;await act(async()=>button.click());await settle();expect(button.getAttribute('aria-pressed')).toBe('true')
 const input=host.querySelector<HTMLInputElement>('[aria-label="搜索快递账号"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'账号');input.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>navigate('/products'));await act(async()=>navigate(getWorkspaceListPath('/carrier-accounts')));await settle()
 expect(button.getAttribute('aria-pressed')).toBe('true');expect(input.value).toBe('账号');expect(host.querySelector('[data-location]')!.textContent).toBe('/carrier-accounts?carrierId=8')
 await act(async()=>navigate('/carrier-accounts?carrierId=7'));await settle();expect([...host.querySelectorAll('[aria-pressed="true"]')].some(b=>b.textContent?.includes('合成账号7'))).toBe(true)
 expect(api.saveCarrierAccountBindingApi).not.toHaveBeenCalled();expect(api.createCarrierAccountApi).not.toHaveBeenCalled()
 }finally{await act(async()=>root.unmount());cache.clear();host.remove();disposeWorkspaceHistoryGuard();useWorkspaceStore.setState({tabs:[HOME_TAB],activeKey:HOME_TAB.key})}
})
