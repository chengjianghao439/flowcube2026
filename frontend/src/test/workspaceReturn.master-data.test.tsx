// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
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
const masterDataLists = [
  { api: 'suppliers', operation: 'getSuppliersApi', placeholder: '搜索编码或名称' },
  { api: 'carriers', operation: 'getCarriersApi', placeholder: '搜索承运商名称或编号' },
  { api: 'warehouses', operation: 'getWarehousesApi', placeholder: '搜索编码或名称' },
  { api: 'locations', operation: 'getLocationsApi', placeholder: '请输入关键字…', menu: true },
  { api: 'racks', operation: 'getRacksApi', placeholder: '请输入关键字…', menu: true },
  { api: 'sorting-bins', operation: 'getSortingBinsApi', placeholder: '请输入关键字…' },
]
for (const item of masterDataLists) test('真实/' + item.api + '与BaseCrud编辑关闭保留已应用筛选、请求与结果', async () => {
  await h.render('/' + item.api)
  const field = () => document.querySelector<HTMLInputElement>(`[role="dialog"] input[placeholder="${item.placeholder}"]`)!
  await h.click('查询')
  await h.input(field(), 'KEEP')
  await h.enter(field())
  const params = lastRead(item.api, item.operation)?.args[0]
  expect(params).toMatchObject({ keyword: 'KEEP' })
  expect(h.activeText()).toContain('SYN42')

  if (item.menu) await h.click('更多操作')
  await h.click('编辑')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await h.click('取消')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await h.go('/dashboard')
  await h.go('/' + item.api)
  expect(lastRead(item.api, item.operation)?.args[0]).toEqual(params)
  expect(h.activeText()).toContain('SYN42')
  await h.click('查询')
  expect(field().value).toBe('KEEP')
  await h.click('取消')
})

test('仓库页头导航切换库位后，两个工作区各自保留当前视图', async () => {
  await h.render('/warehouses')
  const nav = () => [...h.host.querySelectorAll('nav[aria-label="仓库结构视图"]')].find(h.visible)!
  expect(nav().closest('.desktop-page-heading')?.querySelector('h1')?.textContent).toBe('仓库管理')
  expect(nav().querySelector('[aria-current="page"]')?.textContent).toBe('仓库')
  const locations = nav().querySelector<HTMLAnchorElement>('a[href="/locations"]')!
  await act(async () => locations.click())
  await h.settle()
  expect(h.current()).toBe('/locations')
  expect(nav().querySelector('[aria-current="page"]')?.textContent).toBe('库位')
  await h.go('/warehouses')
  expect(nav().querySelector('[aria-current="page"]')?.textContent).toBe('仓库')
})
