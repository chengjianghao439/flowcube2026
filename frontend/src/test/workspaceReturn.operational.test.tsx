// @vitest-environment jsdom
import type { ComponentType } from 'react'
import { beforeEach,afterEach,expect,test,vi } from 'vitest'
import { retentionHarness } from './workspaceRetention'
import { clearReadFixtures,readData,lastRead,paged,writeCalls } from './readOnlyApi'
import InventoryPage from '@/pages/inventory'
import KitsPage from '@/pages/kits'
import CreditPage from '@/pages/credit-overrides'
import PricePage from '@/pages/price-change'
import StockcheckPage from '@/pages/stockcheck'
import DisposalPage from '@/pages/disposal'
import PlasticBoxesPage from '@/pages/plastic-boxes'
import CustomersPage from '@/pages/customers'
import RefundsPage from '@/pages/refunds'
import DepartmentsPage from '@/pages/departments'
import UsersPage from '@/pages/users'
import PdaDevicesPage from '@/pages/settings/pda-devices'
import { savedKit } from '@/pages/kits/kitFixtures.test-data'
const routes=vi.hoisted(()=>({values:{} as Record<string,ComponentType>}))
vi.mock('@/router/routeRegistry',async original=>({...await original<typeof import('@/router/routeRegistry')>(),resolveRouteComponent:(path:string)=>routes.values[path]||null}))
vi.mock('@/api/inventory',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'inventory'))
vi.mock('@/api/kits',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'kits'))
vi.mock('@/api/credit-overrides',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'credit'))
vi.mock('@/api/stockcheck',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'stockcheck'))
vi.mock('@/api/disposal',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'disposal'))
vi.mock('@/hooks/usePlasticBoxes',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'boxes'))
vi.mock('@/api/customers',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'customers'))
vi.mock('@/api/refund',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'refund'))
vi.mock('@/api/departments',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'departments'))
vi.mock('@/api/users',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'users'))
vi.mock('@/api/pda-devices',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'devices'))
vi.mock('@/api/finance',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'finance'))
vi.mock('@/api/warehouses',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'warehouses'))
vi.mock('@/api/categories',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'categories'))
vi.mock('@/api/suppliers',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'suppliers'))
vi.mock('@/api/price-lists',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'price-lists'))
vi.mock('@/api/settings',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'settings'))
vi.mock('@/api/products',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'products'))
vi.mock('@/components/finder',()=>({CustomerFinder:()=>null,SupplierFinder:()=>null,ProductFinder:()=>null,CategoryFinder:()=>null}))
vi.mock('@/components/shared/ProductFinderModal',()=>({default:()=>null}))
vi.mock('@/components/shared/OrderDetailSections',()=>({OrderDetailSections:({children}:{children:React.ReactNode})=><>{children}</>}))
const h=retentionHarness()
const row={id:42,productId:42,code:'SYN42',name:'KEEP命中SYN42',productCode:'SYN42',productName:'KEEP命中SYN42',unit:'个',orderNo:'SYN42',disposalNo:'SYN42',refundNo:'SYN42',checkNo:'SYN42',overrideNo:'SYN42',requestNo:'SYN42',barcode:'SYN42',boxNo:'SYN42',warehouseId:10,warehouseName:'仓10',status:1,statusName:'草稿',statusTone:'draft',createdAt:'2026-10-08',quantity:100,stockQty:100,reservedQty:30,availableQty:70,remainingQty:100,totalQty:100,totalAmount:1,items:[],customerName:'合成客户',supplierName:'合成供应商',thisAmount:1,creditLimit:10,overAmount:0,saleOrderNo:'SO42',applicantName:'合成',roleId:5,roleName:'员工',username:'KEEP-user',realName:'SYN42',deptName:'合成部门',isActive:true,settlementType:1,paymentTermsDays:0,priceLevel:'A',type:1,reason:'合成',priceType:'a',oldPrice:1,newPrice:2}
beforeEach(()=>{
 clearReadFixtures();routes.values={'/inventory':InventoryPage,'/kits':KitsPage,'/credit-overrides':CreditPage,'/price-change':PricePage,'/stockcheck':StockcheckPage,'/disposals':DisposalPage,'/plastic-boxes':PlasticBoxesPage,'/customers':CustomersPage,'/refunds':RefundsPage,'/departments':DepartmentsPage,'/users':UsersPage,'/settings/pda-devices':PdaDevicesPage}
 for(const key of ['inventory.getInventoryOverviewApi','stockcheck.getCheckListApi','disposal.getDisposalListApi','boxes.getPlasticBoxesApi','customers.getCustomersApi','refund.getRefundListApi','users.getUsersApi','credit.listCreditOverridesApi'])readData.set(key,paged(row))
 for(const key of ['stockcheck.getCheckDetailApi','disposal.getDisposalDetailApi','boxes.getPlasticBoxApi','refund.getRefundDetailApi','credit.getCreditOverrideApi'])readData.set(key,row)
 readData.set('departments.listDepartmentsApi',[{...row,parentId:null,sortOrder:0},{...row,id:43,name:'OTHER',code:'OTHER'}]);readData.set('warehouses.getWarehousesActiveApi',[{id:10,name:'仓10',isActive:true}]);readData.set('settings.getSettingsApi',{map:{}})
 readData.set('kits.getKitsApi',paged(savedKit));readData.set('kits.getKitApi',savedKit);readData.set('categories.getCategoryTreeApi',[]);readData.set('suppliers.getSuppliersApi',paged({...row,id:3}));readData.set('products.getProductQtyPoliciesApi',[])
 readData.set('inventory.getInventoryContainersApi',[{...row,id:51,type:1,status:'ACTIVE',remainingQty:100,individual:false}]);readData.set('devices.listPdaDevicesApi',paged({...row,deviceId:'SYN42',deviceCode:'SYN42',deviceName:'SYN42',status:'active'}))
 h.httpData.set('/disposals/handling-sources',{list:[],pagination:{total:0},total:0});h.httpData.set('/price-change',paged(row));h.httpData.set('/price-change/42',row);h.httpData.set('/plastic-boxes/42/movements',[])
})
afterEach(()=>expect(writeCalls).toEqual([]))
const cases=[
 {page:'/inventory',api:'inventory',op:'getInventoryOverviewApi',url:'?keyword=KEEP',open:'查看条码',close:'关闭',result:'SYN42'},
 {page:'/kits',api:'kits',op:'getKitsApi',url:'?keyword=KEEP',open:'维护',close:'关闭',result:'铰链套'},
 {page:'/credit-overrides',api:'credit',op:'listCreditOverridesApi',url:'?keyword=KEEP&status=1',open:'详情 / 记录',close:'关闭',result:'SYN42'},
 {page:'/price-change',api:'http',op:'/price-change',input:'搜索单号/商品…',submit:'搜索',open:'详情 / 记录',close:'关闭',result:'SYN42'},
 {page:'/stockcheck',api:'stockcheck',op:'getCheckListApi',input:'搜索单号/仓库…',submit:'搜索',open:'查看/填写',close:'关闭',result:'SYN42'},
 {page:'/disposals',api:'disposal',op:'getDisposalListApi',dialogQuery:true,open:'查看/处理',close:'关闭',result:'SYN42'},
 {page:'/plastic-boxes',api:'boxes',op:'getPlasticBoxesApi',input:'搜索条码 / 商品…',submit:'搜索',open:'详情',close:'关闭',result:'SYN42'},
 {page:'/customers',api:'customers',op:'getCustomersApi',input:'搜索客户编码或名称',submit:'搜索',open:'编辑',close:'取消',result:'SYN42'},
 {page:'/refunds',api:'refund',op:'getRefundListApi',dialogQuery:true,open:'查看/处理',close:'关闭',result:'SYN42'},
 {page:'/departments',api:'departments',op:'listDepartmentsApi',input:'搜索部门名称',submit:'搜索',open:'编辑',close:'取消',result:'SYN42',localFilter:true},
 {page:'/users',api:'users',op:'getUsersApi',input:'搜索账号或姓名',submit:'搜索',open:'编辑',close:'取消',result:'SYN42'},
 {page:'/settings/pda-devices',api:'devices',op:'listPdaDevicesApi',input:'搜索设备名称或设备码',submit:'',open:'编辑',close:'取消',result:'SYN42'},
]
for(const c of cases)test('实际'+c.page+'筛选→真实详情/抽屉/编辑→关闭/切页返回',async()=>{
 await h.render(c.page+(c.url||''))
 if(c.dialogQuery){await h.click('查询');const input=document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="请输入关键字…"]')!;await h.input(input,'KEEP');await h.enter(input)}
 else if(c.input){const input=h.host.querySelector<HTMLInputElement>(`input[placeholder="${c.input}"]`)!;await h.input(input,'KEEP');if(c.submit)await h.click(c.submit)}
 const request=()=>c.api==='http'?h.httpCalls.filter(x=>x.url===c.op).at(-1)?.params:lastRead(c.api,c.op)?.args[0]
 if(!c.localFilter)expect(request()).toMatchObject({keyword:'KEEP'});const applied=request();expect(h.activeText()).toContain(c.result)
 if(!h.buttons().some(b=>b.textContent?.trim()===c.open))await h.click('更多操作')
 await h.click(c.open);expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(document.querySelector('[role="dialog"]')!.textContent).not.toMatch(/加载失败|读取失败|不存在或已删除/)
 await h.click(c.close);expect(document.querySelector('[role="dialog"]')).toBeNull();await h.go('/dashboard');await h.go(c.page+(c.url||''));expect(request()).toEqual(applied);expect(h.activeText()).toContain(c.result)
 if(c.input)expect(h.host.querySelector<HTMLInputElement>(`input[placeholder="${c.input}"]`)!.value).toBe('KEEP')
 if(c.localFilter)expect(h.activeText()).not.toContain('OTHER')
})
