// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import TransferPage from '@/pages/transfer'
import RequisitionsPage from '@/pages/purchase-requisitions'
import ReturnsPage from '@/pages/returns'
import OpLogsPage from '@/pages/oplogs'
import PickingWavesPage from '@/pages/picking-waves'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import type { WaveQueryValues } from '@/pages/picking-waves/WaveQueryDialog'
const api=vi.hoisted(()=>({transfer:vi.fn(),requisitions:vi.fn(),purchaseReturns:vi.fn(),saleReturns:vi.fn(),logs:vi.fn(),waves:vi.fn(),wave:vi.fn()}))
vi.mock('@/api/transfer',async original=>({...await original<typeof import('@/api/transfer')>(),getTransferListApi:api.transfer}))
vi.mock('@/api/purchase-requisitions',async original=>({...await original<typeof import('@/api/purchase-requisitions')>(),listRequisitionsApi:api.requisitions}))
vi.mock('@/api/returns',async original=>({...await original<typeof import('@/api/returns')>(),getPurchaseReturnsApi:api.purchaseReturns,getSaleReturnsApi:api.saleReturns}))
vi.mock('@/api/oplogs',async original=>({...await original<typeof import('@/api/oplogs')>(),getOpLogsApi:api.logs}))
vi.mock('@/api/picking-waves',async original=>({...await original<typeof import('@/api/picking-waves')>(),getWavesApi:api.waves,getWaveByIdApi:api.wave}))
vi.mock('@/hooks/usePermission',()=>({usePermission:()=>({can:()=>true})}))
vi.mock('@/hooks/useWarehouses',()=>({useWarehousesActive:()=>({data:[]})}))
vi.mock('@/hooks/useUserOptions',()=>({useUserOptions:()=>({options:[]}),userOptionLabel:()=>''}))
vi.mock('@/components/finder',()=>({CustomerFinder:()=>null,SupplierFinder:()=>null,ProductFinder:()=>null}))
vi.mock('@/components/print/OrderPrintOverlay',()=>({OrderPrintOverlay:()=>null}))
vi.mock('@/components/shared/OrderDetailSections',()=>({OrderDetailSections:({children}:{children:React.ReactNode})=><>{children}</>}))
vi.mock('@/pages/picking-waves/WaveQueryDialog',()=>({default:({open,onApply}:{open:boolean;onApply:(v:WaveQueryValues)=>void})=>open?<button onClick={()=>onApply({keyword:'WAVE',status:'1',warehouseId:10,warehouseName:'仓10',startDate:'2026-10-08',endDate:'2026-10-08'})}>应用合成批次查询</button>:null}))
vi.mock('@/router/routeRegistry',async original=>({...await original<typeof import('@/router/routeRegistry')>(),resolveRouteComponent:(path:string)=>({ '/transfer':TransferPage,'/purchase-requisitions':RequisitionsPage,'/returns/purchase':ReturnsPage,'/returns/sale':ReturnsPage,'/oplogs':OpLogsPage,'/picking-waves':PickingWavesPage })[path as '/transfer']||null}))
let host:HTMLDivElement,root:Root,cache:QueryClient,navigate:NavigateFunction
const query={keyword:'CUSTOM',status:'1',warehouseId:'10',warehouseName:'仓10',startDate:'2026-10-08',endDate:'2026-10-08',applicantId:'7',partyId:'9'}
const path=(page:string)=>page+'?'+new URLSearchParams(query)
function Harness(){const location=useLocation();navigate=useNavigate();return <><output data-location>{location.pathname+location.search}</output><KeepAliveOutlet/></>}
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,25))})
const go=async(p:string)=>{await act(async()=>navigate(p));await settle()}
const click=async(label:string)=>{await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].filter(b=>!b.closest('[style*="display: none"]')).find(b=>b.textContent?.trim()===label)!.click());await settle()}
async function render(p:string){await act(async()=>root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[p]}><Harness/></MemoryRouter></QueryClientProvider>));await settle()}
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Element.prototype.scrollIntoView=vi.fn();useWorkspaceStore.setState({tabs:[HOME_TAB],activeKey:HOME_TAB.key});
 for(const spy of Object.values(api))spy.mockReset().mockResolvedValue({list:[],pagination:{total:0}})
 api.waves.mockResolvedValue({list:[{id:42,waveNo:'合成批次42',warehouseId:10,warehouseName:'仓10',status:1,priority:1,taskCount:0,createdAt:'2026-10-08'}],pagination:{total:1}});api.wave.mockResolvedValue({id:42,waveNo:'合成批次42',status:1,items:[]})
 cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();disposeWorkspaceHistoryGuard();vi.unstubAllGlobals();useWorkspaceStore.setState({tabs:[HOME_TAB],activeKey:HOME_TAB.key})})
test.each([{page:'/transfer',spy:'transfer'},{page:'/purchase-requisitions',spy:'requisitions'},{page:'/returns/purchase',spy:'purchaseReturns'},{page:'/returns/sale',spy:'saleReturns'},{page:'/oplogs',spy:'logs'}] as const)('真实列表 $page 隐藏/再返回不读取别的标签条件',async({page,spy})=>{
 await render(path(page));expect(api[spy]).toHaveBeenLastCalledWith(expect.objectContaining({keyword:query.keyword,startDate:query.startDate,endDate:query.endDate}));api[spy].mockClear();await go('/settings?keyword=OTHER')
 expect(api[spy].mock.calls.every(([p])=>p.keyword===query.keyword&&p.startDate===query.startDate)).toBe(true)
 await go(getWorkspaceListPath(page));expect(new URLSearchParams(host.querySelector('[data-location]')!.textContent!.split('?')[1]).get('keyword')).toBe(query.keyword)
})
test('采购/销售退货同时挂载时类型、客户供应商和日期互相独立',async()=>{
 await render(path('/returns/purchase'));api.purchaseReturns.mockClear();await go('/returns/sale?keyword=SALE&partyId=8&startDate=2026-10-09&endDate=2026-10-09')
 expect(api.saleReturns).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'SALE',customerId:8,startDate:'2026-10-09'}));expect(api.purchaseReturns).not.toHaveBeenCalled()
 await go(getWorkspaceListPath('/returns/purchase'));expect(host.querySelector('[data-location]')!.textContent).toContain('keyword=CUSTOM');expect(api.saleReturns.mock.calls.every(([p])=>p.keyword==='SALE')).toBe(true)
})
test('批次应用筛选→打开真实内联详情→关闭，保留API数量范围与查询摘要',async()=>{
 await render('/picking-waves');await click('查询');await click('应用合成批次查询');expect(api.waves).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'WAVE',warehouseId:10,status:'1',startDate:'2026-10-08'}))
 api.waves.mockClear();await click('合成批次42');expect(api.waves.mock.calls.every(([p])=>p.keyword==='WAVE'&&p.warehouseId===10)).toBe(true)
 expect(host.querySelector('[data-location]')!.textContent).toContain('keyword=WAVE');await click('关闭');expect(host.querySelector('[data-location]')!.textContent).not.toContain('waveId=');expect(host.textContent).toContain('批次号：WAVE')
 await go('/settings');await go(getWorkspaceListPath('/picking-waves'));expect(host.textContent).toContain('批次号：WAVE')
})
