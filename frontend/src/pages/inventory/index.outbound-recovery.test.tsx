// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import InventoryPage from './index'
import { useAuthStore } from '@/store/authStore'
import { setApiClientBaseURL } from '@/api/client'
import type { User } from '@/types'
const api = vi.hoisted(()=>({post:vi.fn(),receipt:vi.fn()}))
vi.mock('@/api/inventory',async original=>({...await original<typeof import('@/api/inventory')>(),outboundApi:api.post}))
vi.mock('@/api/operation-requests',()=>({getOperationRequestStatusApi:api.receipt}))
vi.mock('@/hooks/useInventory',async original=>({...await original<typeof import('@/hooks/useInventory')>(),useInventoryOverview:()=>({data:{list:[],pagination:{total:0}}}),useLogs:()=>({data:{list:[],pagination:{total:0}}})}))
vi.mock('@/hooks/useWarehouses',()=>({useWarehousesActive:()=>({data:[{id:7,name:'合成原仓'}]})}))
vi.mock('@/hooks/useCategories',()=>({useCategoryTree:()=>({data:[]})}))
vi.mock('@/hooks/useActiveWorkspaceTab',()=>({useActiveWorkspaceTab:()=>true}))
vi.mock('@/hooks/useProductQtyPolicies',()=>({useProductQtyPolicies:()=>()=>false}))
vi.mock('@/hooks/useInvalidate',()=>({useInvalidate:()=>vi.fn()}))
vi.mock('@/components/finder',()=>({ProductFinder:({open,onConfirm}:{open:boolean;onConfirm:(p:unknown)=>void})=>open?<button onClick={()=>onConfirm({id:3,name:'合成原商品'})}>选中合成商品</button>:null}))
vi.mock('@/components/shared/WarehouseSelect',()=>({WarehouseSelect:({onChange,disabled}:{onChange:(id:number,name:string)=>void;disabled:boolean})=><button type="button" disabled={disabled} onClick={()=>onChange(7,'合成原仓')}>选中合成仓库</button>}))
vi.mock('@/components/shared/ContainerDrawer',()=>({default:()=>null}))
vi.mock('./ReservationDetailsDialog',()=>({default:()=>null}))
let root:Root,host:HTMLDivElement,query:QueryClient
const button=(text:string)=>[...document.body.querySelectorAll('button')].find(b=>b.textContent===text)!
async function mount(){host=document.createElement('div');document.body.append(host);root=createRoot(host);query=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});await act(async()=>root.render(<QueryClientProvider client={query}><MemoryRouter><InventoryPage/></MemoryRouter></QueryClientProvider>))}
async function unmount(){await act(async()=>root.unmount());host.remove();query.clear()}
beforeEach(async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto})
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request: async (_name: string, options: unknown, fn?: (lock: object) => unknown) => (typeof options === 'function' ? options : fn!)({})}})
 localStorage.clear();setApiClientBaseURL('/api');useAuthStore.getState().login('synthetic',null,{id:1,roleId:1,permissions:['inventory.adjust']} as User)
 api.post.mockReset();api.receipt.mockReset();await mount()
})
afterEach(async()=>{await unmount();vi.restoreAllMocks();useAuthStore.getState().logout()})
test('实际库存页未决正文冻结，关弹窗/卸载重开仍显示原商品仓库数量，核成功后清原输入',async()=>{
 await act(async()=>button('出库').click())
 const picker=[...document.body.querySelectorAll('button')].find(b=>b.textContent?.includes('点击选择商品'))!
 await act(async()=>picker.click());await act(async()=>button('选中合成商品').click());await act(async()=>button('选中合成仓库').click())
 const quantity=document.body.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')!
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(quantity,'3');quantity.dispatchEvent(new Event('input',{bubbles:true}))})
 api.post.mockRejectedValueOnce(Object.assign(Error('合成503'),{status:503}))
 await act(async()=>{document.body.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,30))})
 expect(api.post).toHaveBeenCalledOnce();expect(quantity.disabled).toBe(true)
 expect(host.textContent).toContain('合成原商品');expect(host.textContent).toContain('合成原仓');expect(host.textContent).toContain('数量 3')
 await act(async()=>button('取消').click());await unmount();await mount()
 expect(api.post).toHaveBeenCalledOnce();expect(host.textContent).toContain('数量 3')
 await act(async()=>button('出库').click())
 const restored=document.body.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')!
 expect(restored.value).toBe('3');expect(restored.disabled).toBe(true)
 api.receipt.mockResolvedValue({status:'success',resourceType:'inventory',resourceId:3,data:{beforeQty:20,afterQty:17}})
 await act(async()=>button('查询上次结果').click())
 await vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,5))});expect(document.body.querySelector('[role="dialog"]')).toBeNull()})
 expect(api.post).toHaveBeenCalledOnce();expect(document.body.querySelector('[role="dialog"]')).toBeNull()
 await act(async()=>button('出库').click())
 expect(document.body.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')!.value).toBe('')
})
