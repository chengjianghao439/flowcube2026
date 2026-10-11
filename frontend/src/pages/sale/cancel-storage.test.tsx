// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import SalePage from './index'
import SaleFormPage from './form'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { KIT_QUERY_KEY } from '@/lib/kitOperationRecovery'
import type { SaleOrder } from '@/types/sale'

const api=vi.hoisted(()=>({post:vi.fn(),cancel:vi.fn(),query:vi.fn(),list:vi.fn()}))
vi.mock('@/api/client',()=>({default:{defaults:{baseURL:'/synthetic'},post:api.post},subscribeApiClientBaseURL:()=>()=>{},getApiClientBaseURL:()=>'/synthetic',ApiClientError:class extends Error{}}))
vi.mock('@/api/sale',async original=>({...await original<typeof import('@/api/sale')>(),cancelSaleApi:api.cancel,getSaleListApi:api.list}))
vi.mock('@/api/operation-requests',()=>({getOperationRequestStatusApi:api.query}))
vi.mock('@/hooks/useWarehouses',()=>({useWarehousesActive:()=>({data:[]})}))
vi.mock('@/hooks/useUserOptions',()=>({useUserOptions:()=>({options:[]}),userOptionLabel:()=>''}))
vi.mock('@/components/finder',()=>({CustomerFinder:()=>null,ProductFinder:()=>null}))
vi.mock('@/components/shared/OrderFulfillmentPanel',()=>({OrderFulfillmentPanel:()=>null}))
vi.mock('./components/ReserveAllocationDialog',()=>({default:()=>null}))
vi.mock('./components/StockShortageDialog',()=>({default:()=>null}))

const order:SaleOrder={id:12,orderNo:'XS-SYN',customerId:1,customerName:'合成客户',warehouseId:1,warehouseName:'合成仓',status:1,statusName:'草稿',totalAmount:0,operatorId:1,operatorName:'合成人',createdAt:'2026-10-10',items:[]}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  vi.clearAllMocks();sessionStorage.clear()
  api.list.mockResolvedValue({list:[order],pagination:{total:1}})
  useAuthStore.getState().login('synthetic',null,{id:5,roleId:1,permissions:['*']} as never)
})
test.each(['/sale','/sale/12'].flatMap(path=>[false,true].map(badJson=>({path,badJson}))))('普通销售原页面$path坏JSON=$badJson初始化即显示阻断原因，保留存储且不能POST',async({path,badJson})=>{
  const raw=badJson?'not-json':JSON.stringify({version:1,records:[{scope:'ordinary-sale-cancel:list',action:'invalid-query-identity'}]})
  sessionStorage.setItem(KIT_QUERY_KEY,raw)
  const host=document.createElement('div'),root=createRoot(host)
  const cache=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false},mutations:{retry:false}}})
  cache.setQueryData(['sale',12],order)
  cache.setQueryDefaults(['sale'],{queryFn:async()=>({list:[order],pagination:{total:1}})})
  document.body.append(host)
  try {
    await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={cache}><TabPathContext.Provider value={path}>{path==='/sale'?<SalePage />:<SaleFormPage />}</TabPathContext.Provider></QueryClientProvider></MemoryRouter>))
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))})
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('取消查询记录无法核对')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('保留原记录')
    const savedError=host.querySelector('[role="alert"] p:last-child')?.textContent
    expect(savedError).toBeTruthy()
    if(!badJson)expect(savedError).toContain('历史查询记录无法核对归属')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const blocked=[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent=== (path==='/sale'?'占库':'取消订单'))!
    expect(blocked).toBeTruthy();expect(blocked.disabled).toBe(true)
    await act(async()=>blocked.click())
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(raw)
    expect(api.post).not.toHaveBeenCalled();expect(api.cancel).not.toHaveBeenCalled();expect(api.query).not.toHaveBeenCalled()
  } finally {await act(async()=>root.unmount());cache.clear();host.remove();sessionStorage.clear();useAuthStore.setState({user:null,token:null})}
})
