// @vitest-environment jsdom
import type { ComponentType } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { retentionHarness } from './workspaceRetention'
import ProcurementPage from '@/pages/procurement'
import ProcurementDetail from '@/pages/procurement/detail'
import LogisticsPage from '@/pages/logistics'
import LogisticsDetail from '@/pages/logistics/detail'
import ProductsPage from '@/pages/products'
import ProductForm from '@/pages/products/form'
import TransferPage from '@/pages/transfer'
import TransferForm from '@/pages/transfer/form'
import ReturnsPage from '@/pages/returns'
import PurchaseReturnForm from '@/pages/returns/purchase/form'
import SaleReturnForm from '@/pages/returns/sale/form'
import OpLogsPage from '@/pages/oplogs'
const edge=vi.hoisted(()=>({routes:{} as Record<string,ComponentType>,plans:vi.fn(),plan:vi.fn(),waybills:vi.fn(),waybill:vi.fn(),products:vi.fn(),product:vi.fn(),transfers:vi.fn(),transfer:vi.fn(),purchaseReturns:vi.fn(),purchaseReturn:vi.fn(),saleReturns:vi.fn(),saleReturn:vi.fn(),logs:vi.fn(),writes:vi.fn()}))
vi.mock('@/router/routeRegistry',async original=>({...await original<typeof import('@/router/routeRegistry')>(),resolveRouteComponent:(path:string)=>edge.routes[path]||null}))
vi.mock('@/api/procurement',async original=>({...await original<typeof import('@/api/procurement')>(),listPlansApi:edge.plans,getPlanApi:edge.plan,generatePlanApi:edge.writes}))
vi.mock('@/api/logistics',async original=>({...await original<typeof import('@/api/logistics')>(),getWaybillsApi:edge.waybills,getWaybillDetailApi:edge.waybill,getWaybillTrackApi:async()=>[]}))
vi.mock('@/api/products',async original=>({...await original<typeof import('@/api/products')>(),getProductsApi:edge.products,getProductApi:edge.product,updateProductApi:edge.writes,createProductApi:edge.writes}))
vi.mock('@/api/transfer',async original=>({...await original<typeof import('@/api/transfer')>(),getTransferListApi:edge.transfers,getTransferDetailApi:edge.transfer}))
vi.mock('@/api/returns',async original=>({...await original<typeof import('@/api/returns')>(),getPurchaseReturnsApi:edge.purchaseReturns,getPurchaseReturnDetailApi:edge.purchaseReturn,getSaleReturnsApi:edge.saleReturns,getSaleReturnDetailApi:edge.saleReturn}))
vi.mock('@/api/oplogs',async original=>({...await original<typeof import('@/api/oplogs')>(),getOpLogsApi:edge.logs,getAllOpLogsApi:edge.logs,clearLogsApi:edge.writes}))
vi.mock('@/api/carriers',async original=>({...await original<typeof import('@/api/carriers')>(),getCarriersActiveApi:async()=>[]}))
vi.mock('@/api/settings',async original=>({...await original<typeof import('@/api/settings')>(),getSettingsApi:async()=>({map:{}})}))
vi.mock('@/hooks/useWarehouses',()=>({useWarehousesActive:()=>({data:[]})}))
vi.mock('@/hooks/useSuppliers',()=>({useSuppliersActive:()=>({data:[]}),useSuppliers:()=>({data:{list:[]}})}))
vi.mock('@/hooks/useCategories',()=>({useCategoryTree:()=>({data:[]})}))
vi.mock('@/hooks/useCarriers',()=>({useCarriersActive:()=>({data:[]})}))
vi.mock('@/hooks/useUserOptions',()=>({useUserOptions:()=>({options:[]}),userOptionLabel:()=>''}))
vi.mock('@/hooks/useProductQtyPolicies',()=>({useProductQtyPolicies:()=>()=>true}))
vi.mock('@/components/finder',()=>({CustomerFinder:()=>null,SupplierFinder:()=>null,ProductFinder:()=>null,CategoryFinder:()=>null}))
// 不挂载活动/relatedEvents边界；实际单据内容和返回动作仍由真实页面渲染。
vi.mock('@/components/shared/OrderDetailSections',()=>({OrderDetailSections:({children}:{children:React.ReactNode})=><>{children}</>}))
vi.mock('@/components/print/OrderPrintOverlay',()=>({OrderPrintOverlay:()=>null}))
const h=retentionHarness()
const date='2026-10-08'
const row={id:42,code:'SYN42',name:'条件命中记录',orderNo:'SYN42',returnNo:'SYN42',waybillNo:'SYN42',status:1,statusName:'草稿',statusLabel:'草稿',statusTone:'draft',createdAt:date,totalAmount:1,warehouseId:10,warehouseName:'合成仓',fromWarehouseId:10,toWarehouseId:11,fromWarehouseName:'仓10',toWarehouseName:'仓11',operatorId:7,operatorName:'合成',supplierId:9,supplierName:'合成供应商',customerId:9,customerName:'合成客户',forecastWindow:30,horizonDays:30,itemCount:0,defaultLeadTime:3,items:[]}
const product={...row,unit:'个',categoryId:1,categoryName:'类1',isActive:true,costPrice:2,salePriceA:3,salePriceB:3,salePriceC:3,salePriceD:3,salePrice:3,labelSalePrice:3,revision:1,units:[]}
const list=(r:object)=>({list:[r],pagination:{page:1,pageSize:200,total:1}})
beforeEach(()=>{
 for(const spy of Object.values(edge))if(typeof spy==='function')spy.mockReset()
 edge.routes={'/procurement':ProcurementPage,'/procurement/42':ProcurementDetail,'/logistics':LogisticsPage,'/logistics/42':LogisticsDetail,'/products':ProductsPage,'/products/42':ProductForm,'/transfer':TransferPage,'/transfer/42':TransferForm,'/returns/purchase':ReturnsPage,'/returns/purchase/42':PurchaseReturnForm,'/returns/sale':ReturnsPage,'/returns/sale/42':SaleReturnForm,'/oplogs':OpLogsPage}
 for(const spy of [edge.plans,edge.waybills,edge.products,edge.transfers,edge.purchaseReturns,edge.saleReturns])spy.mockResolvedValue(list(row))
 edge.products.mockResolvedValue(list(product));edge.product.mockResolvedValue(product)
 for(const spy of [edge.plan,edge.waybill,edge.transfer,edge.purchaseReturn,edge.saleReturn])spy.mockResolvedValue(row)
 edge.logs.mockResolvedValue(list({...row,method:'GET',path:'/purchase',statusCode:200,module:'purchase',userId:7,userName:'合成',requestBody:{keyword:'KEEP'},responseBody:{list:[]}}))
 edge.writes.mockRejectedValue(new Error('本轮不操作写入'))
})
test('采购计划真实筛选→真实详情页返回列表，控件/请求/结果保留',async()=>{
 await h.render('/procurement');const input=h.host.querySelector<HTMLInputElement>('[placeholder="搜索计划编号/名称…"]')!;await h.input(input,'KEEP');await h.click('搜索');expect(edge.plans).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'KEEP'}))
 await h.click('查看');expect(h.current()).toBe('/procurement/42');expect(h.activeText()).toContain('采购计划 SYN42');await h.click('返回列表');expect(h.current()).toBe('/procurement');expect(input.value).toBe('KEEP');expect(h.activeText()).toContain('条件命中记录');expect(edge.plans.mock.calls.every(([p])=>!p.keyword||p.keyword==='KEEP')).toBe(true)
})
test('物流真实查询→真实详情返回，日期/关键词/请求结果保留',async()=>{
 await h.render('/logistics');await h.click('查询');const input=document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="请输入关键字…"]')!;await h.input(input,'KEEP');await h.enter(input);expect(edge.waybills).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'KEEP'}));const params=edge.waybills.mock.calls.at(-1)![0]
 await h.click('详情');expect(h.current()).toBe('/logistics/42');expect(h.activeText()).toContain('SYN42');await h.click('返回列表');expect(h.activeText()).toContain('关键字：KEEP');expect(edge.waybills.mock.calls.at(-1)![0]).toEqual(params);await h.click('查询');expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="请输入关键字…"]')!.value).toBe('KEEP');await h.click('取消')
})
for(const item of [{page:'/products',spy:'products',title:'SYN42'},{page:'/transfer',spy:'transfers',title:'SYN42'},{page:'/returns/purchase',spy:'purchaseReturns',title:'SYN42'},{page:'/returns/sale',spy:'saleReturns',title:'SYN42'}] as const)test('真实'+item.page+'列表→真实表单/详情→关闭，已应用查询保留',async()=>{
 const original=item.page+'?keyword=KEEP&status=1&warehouseId=10&startDate='+date+'&endDate='+date;await h.render(original);expect(edge[item.spy].mock.calls.some(([params])=>params.keyword==='KEEP')).toBe(true);const params=edge[item.spy].mock.calls.at(-1)![0]
 if(item.page==='/products')await h.click('编辑');else await h.doubleClickRow(item.title);expect(h.current()).toBe(item.page+'/42');expect(h.activeText()).toContain(item.title)
 await h.closeActive();expect(new URLSearchParams(h.current().split('?')[1]).get('keyword')).toBe('KEEP');expect(edge[item.spy].mock.calls.at(-1)![0]).toEqual(params);expect(h.activeText()).toContain(item.title);expect(edge.writes).not.toHaveBeenCalled()
})
test('日志真实筛选→内联详情→关闭，参数和当前结果保留',async()=>{
 await h.render('/oplogs?keyword=KEEP&module=purchase&startDate='+date+'&endDate='+date);const params=edge.logs.mock.calls.at(-1)![0];await h.click('详情');expect(document.querySelector('[role="dialog"]')!.textContent).toContain('操作日志详情');await h.click('关闭');expect(document.querySelector('[role="dialog"]')).toBeNull();expect(h.activeText()).toContain('关键字：KEEP');expect(edge.logs.mock.calls.at(-1)![0]).toEqual(params);expect(edge.writes).not.toHaveBeenCalled()
})
