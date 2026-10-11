// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { useCancelSale } from './useSale'
import { useAuthStore } from '@/store/authStore'
const mocks=vi.hoisted(()=>({cancel:vi.fn(),query:vi.fn(),defaults:{baseURL:'/synthetic'}}))
vi.mock('@/api/client',()=>({default:{defaults:mocks.defaults},ApiClientError:class extends Error{}}))
vi.mock('@/api/sale',()=>({cancelSaleApi:mocks.cancel}))
vi.mock('@/api/operation-requests',()=>({getOperationRequestStatusApi:mocks.query}))
vi.mock('@/hooks/useInvalidate',()=>({useInvalidate:()=>vi.fn()}))
vi.mock('@/lib/toast',()=>({toast:{success:vi.fn(),error:vi.fn()}}))
let hook:ReturnType<typeof useCancelSale>
function Probe(){hook=useCancelSale('synthetic-cancel');return null}
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();vi.clearAllMocks();mocks.defaults.baseURL='/synthetic';useAuthStore.getState().login('synthetic',null,{id:5,roleId:1,permissions:['*']} as never)})
async function mount(run:()=>Promise<void>){
  const host=document.createElement('div'),root=createRoot(host),cache=new QueryClient({defaultOptions:{mutations:{retry:false}}})
  document.body.append(host)
  try{await act(async()=>root.render(<MemoryRouter initialEntries={['/sale']}><QueryClientProvider client={cache}><Probe /></QueryClientProvider></MemoryRouter>));await run()}
  finally{await act(async()=>root.unmount());cache.clear();host.remove()}
}
test('普通取消选填原因只进入本次原请求，未知结果查询后按原正文原键重试',async()=>{
  mocks.cancel.mockRejectedValueOnce({status:503,message:'结果待确认'}).mockResolvedValueOnce(null)
  mocks.query.mockResolvedValue({status:'not_found',data:null})
  await mount(async()=>{
    await act(async()=>{await hook.mutateAsync({id:80,changeReason:'合成取消原因'} as never).catch(()=>{})})
    const first=mocks.cancel.mock.calls[0]
    expect(first[0]).toBe(80);expect(first[2]).toBe('合成取消原因')
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).not.toContain('合成取消原因')
    expect(hook.recovery.pending?.resourceId).toBe(80)
    await act(async()=>{await hook.mutateAsync({id:81,changeReason:'不同正文'} as never).catch(()=>{})})
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    await act(async()=>{await hook.recovery.retry()})
    expect(mocks.query).toHaveBeenCalledWith(first[1],'sale.cancel:80',expect.objectContaining({baseURL:'/synthetic'}))
    expect(mocks.cancel.mock.calls[1]).toEqual(first)
  })
})
test('刷新只恢复原取消查询身份，原因不落盘，也不能重新拼接正文重试',async()=>{
  mocks.cancel.mockRejectedValue({status:503})
  await mount(async()=>{await act(async()=>{await hook.mutateAsync({id:80,changeReason:'仅内存原因'}).catch(()=>{})})})
  expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).not.toContain('仅内存原因')
  mocks.query.mockResolvedValue({status:'not_found',data:null})
  await mount(async()=>{
    expect(hook.recovery.pending?.resourceId).toBe(80)
    expect(hook.recovery.canRetry).toBe(false)
    await act(async()=>{await hook.mutateAsync({id:80,changeReason:'重新拼接原因'}).catch(()=>{})})
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    await act(async()=>{await hook.recovery.queryOriginal()})
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
  })
})
test('原取消未知后改服务器仍冻结，不对新来源重试，也不接受未授权执行',async()=>{
  mocks.cancel.mockRejectedValue({status:503})
  mocks.query.mockResolvedValue({status:'not_found',data:null})
  await mount(async()=>{
    await act(async()=>{await hook.mutateAsync({id:80,changeReason:'合成原因'}).catch(()=>{})})
    mocks.defaults.baseURL='/other'
    await act(async()=>{await hook.recovery.retry()})
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    expect(mocks.query).not.toHaveBeenCalled()
    mocks.defaults.baseURL='/synthetic'
    await act(async()=>useAuthStore.setState({user:{id:5,roleId:2,permissions:[]} as never}))
    await act(async()=>{await hook.recovery.retry()})
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
  })
})
