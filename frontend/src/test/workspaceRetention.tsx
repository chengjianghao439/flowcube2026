import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, vi } from 'vitest'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { WorkspaceTabs } from '@/components/layout/WorkspaceTabs'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import apiClient from '@/api/client'

/** 真实页面/详情保留在工作区内，唯有另一个无业务的切页目标为空。API全部在各用例边界隔离。 */
export function retentionHarness() {
 let host: HTMLDivElement, root: Root, cache: QueryClient, navigate: NavigateFunction
 const httpData=new Map<string,unknown>(),httpCalls:{url:string;params:unknown}[]=[]
 const unexpected: string[]=[]; const originalAdapter=apiClient.defaults.adapter
 const originalAuth=useAuthStore.getState()
 function Harness(){const location=useLocation();navigate=useNavigate();return <><output data-location>{location.pathname+location.search}</output><WorkspaceTabs/><KeepAliveOutlet/></>}
 const visible=(el:Element)=>!el.closest('[hidden],[style*="display: none"]')
 const settle=()=>act(async()=>{await vi.dynamicImportSettled();await new Promise(resolve=>setTimeout(resolve,20))})
 beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Element.prototype.scrollIntoView=vi.fn();Element.prototype.hasPointerCapture=()=>false;Element.prototype.setPointerCapture=vi.fn();Element.prototype.releasePointerCapture=vi.fn()
  useAuthStore.getState().login('offline-fixture',null,{id:7,roleId:1,permissions:['*'],username:'fixture',realName:'合成',roleName:'测试'})
  useWorkspaceStore.setState({tabs:[HOME_TAB],activeKey:HOME_TAB.key});useDirtyGuardStore.setState({dirtyTabs:{},pendingConfirm:null,bypassNextBlock:false});unexpected.length=0;httpData.clear();httpCalls.length=0;httpData.set('/auth/me',structuredClone(useAuthStore.getState().user))
  apiClient.defaults.adapter=async config=>{if(config.method==='get'&&httpData.has(config.url!)){httpCalls.push({url:config.url!,params:config.params});return {config,headers:{},status:200,statusText:'OK',data:{success:true,data:structuredClone(httpData.get(config.url!))}}}unexpected.push(String(config.method)+' '+config.url);throw new Error('Unexpected test API: '+config.url)}
  cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});host=document.createElement('div');document.body.append(host);root=createRoot(host)
 })
 afterEach(async()=>{
  await act(async()=>root.unmount());cache.clear();host.remove();apiClient.defaults.adapter=originalAdapter;vi.unstubAllGlobals();disposeWorkspaceHistoryGuard();useAuthStore.setState(originalAuth);useWorkspaceStore.setState({tabs:[HOME_TAB],activeKey:HOME_TAB.key});useDirtyGuardStore.setState({dirtyTabs:{},pendingConfirm:null});expect(unexpected).toEqual([])
 })
 return {
  httpData,httpCalls,
  get host(){return host},get cache(){return cache},settle,visible,
  current:()=>host.querySelector('[data-location]')!.textContent!,
  render:async(path:string)=>{await act(async()=>root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><Harness/></MemoryRouter></QueryClientProvider>));await settle()},
  go:async(path:string|number)=>{await act(async()=>typeof path==='number'?navigate(path):navigate(path));await settle()},
  select:async(label:string,option:string)=>{const el=[...document.querySelectorAll<HTMLElement>('[role="combobox"]')].filter(visible).find(b=>b.textContent?.trim()===label)!;expect(el,label).toBeDefined();await act(async()=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));await settle();const target=[...document.querySelectorAll<HTMLElement>('[role="option"]')].find(b=>b.textContent?.trim()===option)!;expect(target,option).toBeDefined();await act(async()=>target.click());await settle()},
  closeActive:async()=>{const state=useWorkspaceStore.getState();const tab=state.tabs.find(t=>t.key===state.activeKey)!;const label='关闭 '+tab.title;const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===label||b.getAttribute('title')===label)!;expect(button,label).toBeDefined();await act(async()=>button.click());await settle()},
  buttons:()=>[...document.querySelectorAll<HTMLButtonElement>('button')].filter(visible),
  click:async(label:string,scope:ParentNode=document)=>{const el=[...scope.querySelectorAll<HTMLElement>('button,[role="menuitem"],[role="option"]')].filter(visible).find(b=>b.textContent?.trim()===label||b.getAttribute('aria-label')===label||b.getAttribute('title')===label);expect(el,label).toBeDefined();await act(async()=>el!.click());await settle()},
  input:async(el:HTMLInputElement,value:string)=>{expect(el).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});await settle()},
  enter:async(el:HTMLInputElement)=>{await act(async()=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));await settle()},
  doubleClickRow:async(text:string)=>{const row=[...host.querySelectorAll('tbody tr')].filter(visible).find(r=>r.textContent?.includes(text));expect(row,text).toBeDefined();await act(async()=>row!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));await settle()},
  activeText:()=>[...host.querySelectorAll('[data-workspace-scroll]')].filter(visible).map(el=>el.textContent).join(''),
 }
}
