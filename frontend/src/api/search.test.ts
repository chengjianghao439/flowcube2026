import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api from './client'
import { searchGlobalApi, type GlobalSearchPage } from './search'

const auth = vi.hoisted(() => ({sessionGeneration:4,token:'fixture'}))
vi.mock('@/store/authStore',()=>({useAuthStore:{getState:()=>auth}}))
vi.mock('@/store/companyStore',()=>({useCompanyStore:{getState:()=>({companyId:1})}}))
vi.mock('@/lib/platform',()=>({IS_CAPACITOR_PDA:false}))
vi.mock('@/lib/authSession',()=>({performSessionLogout:vi.fn()}))
vi.mock('@/lib/toast',()=>({toast:{error:vi.fn()}}))
vi.mock('@/config/api',()=>({hasUserConfiguredApiOrigin:()=>true}))
vi.mock('@/lib/pdaDeviceBinding',()=>({getDeviceSession:()=>null}))
vi.mock('./pda-session',()=>({ensureDeviceSession:vi.fn(),renewDeviceSession:vi.fn()}))

const originalAdapter=api.defaults.adapter
const unknown:string[]=[]
beforeEach(()=>{auth.sessionGeneration=4;unknown.length=0})
afterEach(()=>{api.defaults.adapter=originalAdapter;expect(unknown).toEqual([])})
function installResponses(...pages:(unknown|Error)[]) {
  const requests:InternalAxiosRequestConfig[]=[]
  let keyword:string|undefined
  let cursors:Array<{type:string;beforeId:number}>=[]
  api.defaults.adapter=async config=>{
    const expected=keyword===undefined ? {q:config.params?.q,paginated:'1'} : {q:keyword,paginated:'1',...cursors[0]}
    if(config.method!=='get'||config.url!=='/search'||JSON.stringify(config.params)!==JSON.stringify(expected)) {
      unknown.push(`${config.method} ${config.url}`);throw new Error('unknown search request')
    }
    const initial=keyword===undefined
    keyword=config.params.q
    requests.push(config)
    const data=pages.shift()
    if(data instanceof Error) throw data
    if(data==null){unknown.push(`${config.method} ${config.url}`);throw new Error('没有配置此请求的响应')}
    const page=data as GlobalSearchPage
    if(initial)cursors=Object.entries(page.nextCursors).filter((entry):entry is [string,number]=>entry[1]!=null).map(([type,beforeId])=>({type,beforeId}))
    else {const next=page.nextCursors[cursors[0].type];if(next==null)cursors.shift();else cursors[0]={type:cursors[0].type,beforeId:next}}
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data}}
  }
  return requests
}
test('真实payloadClient解包搜索各类数字游标，保持关键词和登录范围',async()=>{
  const requests=installResponses(
    {items:[{id:30,type:'customer'}],nextCursors:{customer:30,sale:15}},
    {items:[{id:20,type:'customer'}],nextCursors:{customer:20}},
    {items:[{id:10,type:'customer'}],nextCursors:{customer:null}},
    {items:[{id:1,type:'sale'}],nextCursors:{sale:null}},
  )
  const response=await searchGlobalApi('客户')
  expect(response.items).toHaveLength(4)
  expect(response.nextCursors).toEqual({})
  expect(requests).toHaveLength(4)
  for(const config of requests){expect(config.params.q).toBe('客户');expect(config._authSessionGeneration).toBe(4)}
})
test('续批失败或游标未推进，不返回残缺结果',async()=>{
  installResponses({items:[{id:30}],nextCursors:{customer:30}},new Error('网络失败'))
  await expect(searchGlobalApi('客户')).rejects.toThrow('网络失败')
  installResponses({items:[{id:30}],nextCursors:{customer:30}},{items:[{id:30}],nextCursors:{customer:30}})
  await expect(searchGlobalApi('客户')).rejects.toThrow('变化')
})
test('全部批次取齐后低id精确商品优先，只排序商品并保留同等级与其它组顺序',async()=>{
  const signal = new AbortController().signal
  const requests=installResponses(
    {items:[{id:30,type:'product',searchRank:1},{id:40,type:'customer'},{id:29,type:'product',searchRank:1}],nextCursors:{product:29,customer:null}},
    {items:[{id:2,type:'product',searchRank:0,searchMatch:'编码'},{id:1,type:'product',searchRank:1}],nextCursors:{product:null}},
  )
  const response = await searchGlobalApi('  P2  ', {signal})
  expect(response.items.map(item=>[item.type,item.id])).toEqual([['product',2],['customer',40],['product',30],['product',29],['product',1]])
  expect(response.items[0].searchMatch).toBe('编码')
  for (const config of requests) {
    expect(config.signal).toBe(signal)
    expect(config._authSessionGeneration).toBe(4)
    expect(config.params.q).toBe('P2')
  }
  expect(requests[1].params.beforeId).toBe(29)
})
test('搜索期间切换登录或取消请求，不返回旧批次结果',async()=>{
  let release!:(page:GlobalSearchPage)=>void
  api.defaults.adapter=async config=>{if(config.method!=='get'||config.url!=='/search'){unknown.push(`${config.method} ${config.url}`);throw new Error('unknown search request')}return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:await new Promise<GlobalSearchPage>(resolve=>{release=resolve})}}}
  const response=searchGlobalApi('客户')
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
  auth.sessionGeneration=5
  release({items:[],nextCursors:{}})
  await expect(response).rejects.toThrow('登录状态')
  const controller=new AbortController();controller.abort()
  await expect(searchGlobalApi('客户',{signal:controller.signal})).rejects.toThrow('取消')
})

test('取齐超过20商品及混合客户/销售全部页后四档排序，低id exact最后页不漏不重',async()=>{
 const product=(id:number)=>({id,type:'product',typeLabel:'商品',title:`P${id}`,subtitle:'',path:'/products',...(id===1?{searchRank:0}:id===2?{searchRank:1}:id===3?{searchRank:2}:id===4?{}:{searchRank:3})})
 const other=(id:number,type:string)=>({id,type,typeLabel:type,title:`${type}${id}`,subtitle:'',path:'/'})
 const first={items:[...Array.from({length:20},(_,i)=>product(25-i)),...Array.from({length:20},(_,i)=>other(24-i,'customer')),...Array.from({length:20},(_,i)=>other(21-i,'sale'))],nextCursors:{product:6,customer:5,sale:2}}
 const rest=[{items:Array.from({length:5},(_,i)=>product(5-i)),nextCursors:{product:null}},{items:Array.from({length:4},(_,i)=>other(4-i,'customer')),nextCursors:{customer:null}},{items:[other(1,'sale')],nextCursors:{sale:null}}]
 const requests=installResponses(first,...rest)
 const result=await searchGlobalApi('M6')
 const products=result.items.filter(item=>item.type==='product')
 expect(products.map(item=>item.id)).toEqual([1,2,3,...Array.from({length:22},(_,i)=>25-i)])
 const original=[...first.items,...rest.flatMap(page=>page.items)]
 expect(result.items.filter(item=>item.type!=='product')).toEqual(original.filter(item=>item.type!=='product'))
 expect(result.items.map(item=>item.type)).toEqual(original.map(item=>item.type))
 expect(new Set(result.items.map(item=>`${item.type}:${item.id}`)).size).toBe(70)
 expect(requests.map(c=>c.params)).toEqual([{q:'M6',paginated:'1'},{q:'M6',paginated:'1',type:'product',beforeId:6},{q:'M6',paginated:'1',type:'customer',beforeId:5},{q:'M6',paginated:'1',type:'sale',beforeId:2}])
 installResponses(first,rest[0],rest[1],new Error('最后销售页失败'))
 await expect(searchGlobalApi('M6')).rejects.toThrow('最后销售页失败')
})
test('同rank按显式数字id降序，缺rank按包含档3，只换商品槽位',async()=>{
 installResponses({items:[{id:11,type:'product',searchRank:1},{id:40,type:'customer'},{id:13,type:'product',searchRank:1},{id:50,type:'product'},{id:12,type:'product',searchRank:2}],nextCursors:{}})
 const result=await searchGlobalApi('M6')
 expect(result.items.map(item=>[item.type,item.id])).toEqual([['product',13],['customer',40],['product',11],['product',12],['product',50]])
})
