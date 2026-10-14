// @vitest-environment jsdom
import {act,useState} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {webcrypto} from 'node:crypto'
import {useAuthStore} from '@/store/authStore'
import {useShipSale} from '@/hooks/useSale'
import {ApiClientError} from '@/api/client'
import ReserveDialog from './ReserveAllocationDialog'
import ReleaseDialog from './ReleaseAllocationDialog'
import ShipDialog from './ShipSelectDialog'
import type {ReservePreview,SaleOrder} from '@/types/sale'
const transport=vi.hoisted(()=>({reserve:vi.fn(),release:vi.fn(),ship:vi.fn(),receipt:vi.fn()}))
vi.mock('@/api/sale',async importOriginal=>({...await importOriginal<typeof import('@/api/sale')>(),getSaleReservePreviewApi:async()=>preview,reserveSaleApi:transport.reserve,releaseSaleApi:transport.release,shipSaleApi:transport.ship}))
vi.mock('@/api/operation-requests',()=>({getOperationRequestStatusApi:transport.receipt}))
vi.mock('@/components/shared/WarehouseSelect',()=>({WarehouseSelect:(p:{id?:string;value:number;disabled?:boolean})=><select id={p.id} value={p.value} disabled={p.disabled} onChange={()=>{}}><option value={p.value}>合成仓</option></select>}))
const item={id:17,productId:27,productCode:'SYNTHETIC-P',productName:'合成商品',unit:'个',warehouseId:1,warehouseName:'合成仓',quantity:10,reservedQty:10,dispatchedQty:0,unitPrice:20,amount:200}
const order:SaleOrder={id:7,orderNo:'SYNTHETIC-SALE',customerId:3,customerName:'合成客户',warehouseId:1,warehouseName:'合成仓',status:2,statusName:'已占库',totalAmount:200,operatorId:9,operatorName:'合成员工',createdAt:'',items:[item]}
const preview:ReservePreview={orderId:7,warehouseId:1,warehouseName:'合成仓',items:[{...item,itemId:17,reservedQty:0,remainToReserve:10,currentWarehouseId:1,currentWarehouseName:'合成仓',warehouses:[{warehouseId:1,warehouseName:'合成仓',available:10}]}]}
let root:Root,host:HTMLDivElement,qc:QueryClient
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,fn:()=>unknown)=>fn()}});localStorage.clear();sessionStorage.clear();for(const mock of Object.values(transport))mock.mockReset();useAuthStore.getState().login('synthetic',null,{id:9,username:'synthetic',realName:'合成员工',roleId:1,roleName:'测试'});host=document.createElement('div');document.body.append(host);root=createRoot(host);qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})})
afterEach(async()=>{await act(async()=>root.unmount());qc.clear();host.remove();useAuthStore.getState().logout();localStorage.clear();sessionStorage.clear()})
function ShipHost(){const [open,setOpen]=useState(true),write=useShipSale(7);return <ShipDialog open={open} order={order} onClose={()=>setOpen(false)} loading={write.isPending} recovery={write.recovery} onConfirm={items=>write.mutate({id:7,items},{onSuccess:()=>setOpen(false)})}/>}
const samples=[{kind:'reserve',text:'确认占用（1 项）',render:()=> <ReserveDialog open orderId={7} onClose={()=>{}} onShortage={()=>{}}/>},{kind:'release',text:'释放选中 1 项',render:()=> <ReleaseDialog open orderId={7} items={[item]} onClose={()=>{}}/>},{kind:'ship',text:'确认发起出库',render:()=> <ShipHost/>}] as const
const button=(s:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===s)!
async function type(v:string){await act(async()=>{const field=document.querySelector<HTMLInputElement>('input[type="number"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,v);field.dispatchEvent(new Event('input',{bubbles:true}))})}
async function mount(node:React.ReactNode){await act(async()=>root.render(<MemoryRouter><QueryClientProvider client={qc}>{node}</QueryClientProvider></MemoryRouter>));await vi.waitFor(()=>expect(document.querySelector('input[type="number"]')).toBeTruthy())}
test.each(samples)('$kind 提交后响应丢失：原数量冻结，禁止改量另发，查询原结果才结束',async s=>{transport[s.kind].mockRejectedValue(new ApiClientError({message:'本次合成响应丢失',status:0}));transport.receipt.mockResolvedValue({status:'success',resourceType:'sale_order',resourceId:7,data:s.kind==='ship'?{tasks:[{taskId:91,taskNo:'SYNTHETIC-WT',warehouseName:'合成仓'}],partial:true,remaining:1}:null});await mount(s.render());await type('4');await act(async()=>button(s.text).click());await vi.waitFor(()=>expect(transport[s.kind]).toHaveBeenCalledOnce());await vi.waitFor(()=>{expect(document.querySelector<HTMLInputElement>('input[type="number"]')!.disabled).toBe(true);expect(button(s.text)?.disabled).toBe(true)});await type('6');expect([...document.querySelectorAll('button')].map(b=>b.textContent)).toContain(s.text);await act(async()=>button(s.text).click());expect(transport[s.kind]).toHaveBeenCalledOnce();expect(document.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('4');await act(async()=>button('查询原操作结果').click());await vi.waitFor(()=>expect(transport.receipt).toHaveBeenCalledOnce());expect(transport.receipt.mock.calls[0][1]).toBe('sale.'+s.kind+':7');expect(transport[s.kind]).toHaveBeenCalledOnce()})
