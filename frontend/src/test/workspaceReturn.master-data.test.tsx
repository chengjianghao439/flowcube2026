// @vitest-environment jsdom
import type { ComponentType } from 'react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { retentionHarness } from './workspaceRetention'
import { clearReadFixtures, readData, lastRead, paged, writeCalls } from './readOnlyApi'
import SuppliersPage from '@/pages/suppliers'
import CarriersPage from '@/pages/carriers'
import WarehouseStructurePage from '@/pages/warehouse-structure'
const routes=vi.hoisted(()=>({values:{} as Record<string,ComponentType>}))
vi.mock('@/router/routeRegistry',async original=>({...await original<typeof import('@/router/routeRegistry')>(),resolveRouteComponent:(path:string)=>routes.values[path]||null}))
vi.mock('@/api/suppliers',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'suppliers'))
vi.mock('@/api/carriers',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'carriers'))
vi.mock('@/api/warehouses',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'warehouses'))
vi.mock('@/api/locations',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'locations'))
vi.mock('@/api/racks',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'racks'))
vi.mock('@/api/sorting-bins',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'sorting-bins'))
const h=retentionHarness()
const row={id:42,code:'SYN42',name:'合成命中记录',warehouseId:42,warehouseName:'合成仓',zone:'A',aisle:'01',row:'01',column:'01',level:'01',locationType:1,rackNo:'A01',capacity:5,status:1,isActive:true,settlementType:2,settlementTypeName:'月结',paymentTermsDays:30,leadTimeDays:1,platformCode:null,barcode:'SYN42',remainingQty:1,remark:''}
beforeEach(()=>{
 clearReadFixtures();routes.values={'/suppliers':SuppliersPage,'/carriers':CarriersPage,...Object.fromEntries(['/warehouses','/locations','/racks','/sorting-bins'].map(p=>[p,WarehouseStructurePage]))}
 for(const api of ['suppliers','carriers','warehouses','locations','racks'])readData.set(api+'.get'+api[0].toUpperCase()+api.slice(1)+'Api',paged(row))
 readData.set('warehouses.getWarehousesActiveApi',[{id:42,name:'合成仓',isActive:true}]);readData.set('sorting-bins.getSortingBinsApi',[row])
})
afterEach(()=>expect(writeCalls).toEqual([]))
for(const item of [{api:'suppliers',operation:'getSuppliersApi',dialogQuery:false,menu:false},{api:'carriers',operation:'getCarriersApi',dialogQuery:false,menu:false},{api:'warehouses',operation:'getWarehousesApi',dialogQuery:false,menu:false},{api:'locations',operation:'getLocationsApi',dialogQuery:true,menu:true},{api:'racks',operation:'getRacksApi',dialogQuery:true,menu:true},{api:'sorting-bins',operation:'getSortingBinsApi',dialogQuery:true,menu:false}])test('真实/'+item.api+'与BaseCrud编辑关闭保留已应用筛选、请求与结果',async()=>{
 await h.render('/'+item.api)
 if(item.dialogQuery){await h.click('查询');const input=document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="请输入关键字…"]')!;await h.input(input,'KEEP');await h.enter(input)}
 else {const input=h.host.querySelector<HTMLInputElement>('input[aria-label^="搜索"]')!;await h.input(input,'KEEP');await h.enter(input)}
 expect(lastRead(item.api,item.operation)?.args[0]).toMatchObject({keyword:'KEEP'});const params=lastRead(item.api,item.operation)?.args[0]
 expect(h.activeText()).toContain('SYN42')
 if(item.menu)await h.click('更多操作');await h.click('编辑');expect(document.querySelector('[role="dialog"]')).not.toBeNull();await h.click('取消');expect(document.querySelector('[role="dialog"]')).toBeNull()
 await h.go('/dashboard');await h.go('/'+item.api)
 expect(lastRead(item.api,item.operation)?.args[0]).toEqual(params);expect(h.activeText()).toContain('SYN42')
 if(item.dialogQuery){await h.click('查询');expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="请输入关键字…"]')!.value).toBe('KEEP');await h.click('取消')}
 else expect(h.host.querySelector<HTMLInputElement>('input[aria-label^="搜索"]')!.value).toBe('KEEP')
})
