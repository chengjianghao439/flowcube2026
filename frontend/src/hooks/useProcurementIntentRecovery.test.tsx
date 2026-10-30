// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {createHash,webcrypto} from 'node:crypto'
import {useProcurementIntentRecovery,procurementIntentFingerprint,validProcurementResult,type ProcurementIntentDomain,type ProcurementIntentBody,type ProcurementQuery} from './useProcurementIntentRecovery'
import {useAuthStore} from '@/store/authStore'
import {setApiClientBaseURL} from '@/api/client'
import {PERMISSIONS} from '@/lib/permission-codes'
const api=vi.hoisted(()=>({pr:vi.fn(),plan:vi.fn(),receipt:vi.fn()}))
vi.mock('@/api/procurement',()=>({convertPlanApi:api.plan}))
vi.mock('@/api/operation-requests',()=>({getOperationRequestStatusApi:api.receipt}))
let root:Root,host:HTMLDivElement,op:ReturnType<typeof useProcurementIntentRecovery>
const domains=['plan-convert'] as const
const user=(id=9)=>({id,username:'synthetic'+id,realName:'合成员工',roleId:9,roleName:'合成权限',permissions:[PERMISSIONS.PROCUREMENT_PLAN_MANAGE,PERMISSIONS.PURCHASE_ORDER_CREATE]})
const body=(_domain:ProcurementIntentDomain,n=4):ProcurementIntentBody=>({itemIds:[n]})
const fn=(_domain:ProcurementIntentDomain)=>api.plan
const saved=()=>Object.keys(localStorage).filter(k=>k.startsWith('flowcube-procurement-intent-v1:request:'))
const record=():ProcurementQuery=>JSON.parse(localStorage.getItem(saved()[0])!)
const ack=(r:ProcurementQuery)=>({planId:r.resourceId,planStatus:2,createdOrders:[{purchaseOrderId:91,orderNo:'SYNTHETIC-PO'}],requestFingerprint:r.fingerprint})
const receipt=(r:ProcurementQuery)=>({status:'success',resourceType:'procurement_plan',resourceId:r.resourceId,data:ack(r)})
function Probe({domain,id=7,active=true}:{domain:ProcurementIntentDomain;id?:number;active?:boolean}){op=useProcurementIntentRecovery(domain,id,active);return null}
const mount=(domain:ProcurementIntentDomain,id=7,active=true)=>act(async()=>root.render(<Probe domain={domain} id={id} active={active}/>))
async function fail(domain:ProcurementIntentDomain){fn(domain).mockRejectedValue({status:0,message:'响应未知'});await act(async()=>{await expect(op.submit(body(domain))).rejects.toBeTruthy()});expect(saved()).toHaveLength(1)}
async function remount(domain:ProcurementIntentDomain){await act(async()=>root.unmount());root=createRoot(host);await mount(domain)}
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,f:()=>unknown)=>f()}});localStorage.clear();sessionStorage.clear();Object.values(api).forEach(m=>m.mockReset());setApiClientBaseURL('http://synthetic.invalid/api');useAuthStore.getState().login('synthetic',null,user());host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();useAuthStore.getState().logout();localStorage.clear();sessionStorage.clear();vi.restoreAllMocks()})
test('计划转换指纹绑定原单与canonical选择集合',async()=>{
 const hash=await procurementIntentFingerprint('plan-convert',{itemIds:[9,3,9]},7)
 expect(hash).toBe(createHash('sha256').update('{"itemIds":[3,9],"planId":7,"target":"purchase"}').digest('hex'))
 expect(hash).toBe(await procurementIntentFingerprint('plan-convert',{itemIds:[3,9]},7));expect(hash).not.toBe(await procurementIntentFingerprint('plan-convert',{itemIds:[3]},7))
})
test.each(domains)('%s 未知无持久body；改body阻；pending不POST；notfound原body/key重试',async domain=>{
 await mount(domain);const original=body(domain);fn(domain).mockRejectedValue({status:0});await act(async()=>{await expect(op.submit(original)).rejects.toBeTruthy()});const r=record(),first=fn(domain).mock.calls[0]
 original.itemIds[0]=6
 expect(r).toMatchObject({domain,userId:9,baseURL:'http://synthetic.invalid/api',method:'post'});expect(r.fingerprint).toMatch(/^[a-f0-9]{64}$/);for(const name of ['body','items','token'])expect(r).not.toHaveProperty(name)
 await act(async()=>{await expect(op.submit(body(domain,6))).rejects.toThrow('待确认')});expect(fn(domain)).toHaveBeenCalledOnce()
 api.receipt.mockResolvedValue({status:'pending'});await act(async()=>{await op.retry()});expect(fn(domain)).toHaveBeenCalledOnce()
 api.receipt.mockResolvedValue({status:'not_found'});fn(domain).mockResolvedValue(ack(r));await act(async()=>{await op.retry()});expect(fn(domain)).toHaveBeenCalledTimes(2)
 expect(fn(domain).mock.calls[1]).toEqual(first);expect(first.at(-1)).toMatchObject({baseURL:r.baseURL,automaticReplay:false,_erpApiFallbackTried:true,headers:{'X-Request-Key':r.requestKey}})
 expect(first[1]).toEqual([4]);expect(saved()).toHaveLength(0)
})
test.each(domains)('%s cold仅GET；notfound不清；success后明确新intent',async domain=>{
 await mount(domain);await fail(domain);const r=record();await remount(domain);expect(op.canRetry).toBe(false)
 api.receipt.mockResolvedValue({status:'not_found'});await act(async()=>{await expect(op.retry()).rejects.toThrow('重挂')});expect(fn(domain)).toHaveBeenCalledOnce();expect(op.blocked).toBe(true)
 api.receipt.mockResolvedValue(receipt(r));await act(async()=>{expect(await op.queryOriginal()).toMatchObject({status:'success',queryOnly:true})});expect(fn(domain)).toHaveBeenCalledOnce();expect(op.blocked).toBe(false)
 expect(api.receipt.mock.calls.at(-1)).toEqual([r.requestKey,r.action,expect.objectContaining({baseURL:r.baseURL,params:{requestFingerprint:r.fingerprint,}})])
 fn(domain).mockImplementation(async()=>ack(record()));await act(async()=>{await op.submit(body(domain,6))});expect(fn(domain)).toHaveBeenCalledTimes(2);expect(fn(domain).mock.calls[1].at(-1).headers['X-Request-Key']).not.toBe(r.requestKey)
})
test.each(domains)('%s first409/legacyreview/异意图conflict保留原身份',async domain=>{
 for(const code of ['CONFLICT','PROCUREMENT_CONVERT_REQUEST_CONFLICT']){localStorage.clear();await remount(domain);fn(domain).mockRejectedValue({status:409,code});await act(async()=>{await expect(op.submit(body(domain))).rejects.toBeTruthy()});expect(saved()).toHaveLength(1);expect(op.blocked).toBe(true)}
})
test('firstcoverage明确回滚可结束；retry相同409仍unknown',async()=>{
 await mount('plan-convert');api.plan.mockRejectedValue({status:409,code:'PROCUREMENT_COVERAGE_CHANGED'});await act(async()=>{await expect(op.submit(body('plan-convert'))).rejects.toBeTruthy()});expect(saved()).toHaveLength(0)
 await fail('plan-convert');api.receipt.mockResolvedValue({status:'not_found'});api.plan.mockRejectedValue({status:409,code:'PROCUREMENT_COVERAGE_CHANGED'});await act(async()=>{await expect(op.retry()).rejects.toBeTruthy()});expect(saved()).toHaveLength(1)
})
test.each(domains)('%s failed/GET503无bodyproof不结束；retry4xx保留',async domain=>{
 await mount(domain);await fail(domain);api.receipt.mockResolvedValue({status:'failed',data:null});await act(async()=>{await op.queryOriginal()});expect(saved()).toHaveLength(1)
 api.receipt.mockRejectedValue({status:503});await act(async()=>{await expect(op.queryOriginal()).rejects.toBeTruthy()});expect(saved()).toHaveLength(1)
 api.receipt.mockResolvedValue({status:'not_found'});fn(domain).mockRejectedValue({status:400,code:'BUSINESS_ERROR'});await act(async()=>{await expect(op.retry()).rejects.toBeTruthy()});expect(saved()).toHaveLength(1)
})
test.each(domains)('%s wrongresource/hash/warehouse/empty/duplicate rawDTO拒确认',async domain=>{
 await mount(domain);await fail(domain);const r=record(),good=receipt(r)
 const bad=[null,{...ack(r),requestFingerprint:'0'.repeat(64)},{...ack(r),planId:8},{...ack(r),createdOrders:[]},{...ack(r),createdOrders:[{purchaseOrderId:1,orderNo:'SYNTHETIC'},{purchaseOrderId:1,orderNo:'SYNTHETIC'}]}]
 for(const data of bad){expect(validProcurementResult(r,data)).toBe(false);api.receipt.mockResolvedValue({...good,data});await act(async()=>{await expect(op.queryOriginal()).rejects.toThrow('不一致')});expect(saved()).toHaveLength(1)}
 api.receipt.mockResolvedValue({...good,resourceId:999});await act(async()=>{await expect(op.queryOriginal()).rejects.toThrow('不一致')});expect(saved()).toHaveLength(1)
})
test.each(domains)('%s terminal旧pending副本notfound不重发',async domain=>{
 await mount(domain);await fail(domain);const r=record(),k=saved()[0],raw=localStorage.getItem(k)!;api.receipt.mockResolvedValue(receipt(r));await act(async()=>{await op.queryOriginal()});localStorage.setItem(k,raw);await mount(domain);api.receipt.mockResolvedValue({status:'not_found'});await act(async()=>{await op.retry()});expect(fn(domain)).toHaveBeenCalledOnce();expect(saved()).toHaveLength(1)
})
test.each(domains)('%s 七日minusmargin禁止重试；GET仍可',async domain=>{
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);await mount(domain);await fail(domain);vi.mocked(Date.now).mockReturnValue(now+7*86400000-120000);api.receipt.mockResolvedValue({status:'not_found'});await act(async()=>{await expect(op.retry()).rejects.toThrow('安全重试时限')});expect(fn(domain)).toHaveBeenCalledOnce()
})
test('quota/readback/缺locks发送前阻断',async()=>{
 await mount('plan-convert');const set=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,v){if(k.startsWith('flowcube-procurement-intent-v1:request:'))throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v)});await act(async()=>{await expect(op.submit(body('plan-convert'))).rejects.toBeTruthy()});expect(api.plan).not.toHaveBeenCalled();vi.restoreAllMocks()
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,v){if(!k.startsWith('flowcube-procurement-intent-v1:request:'))return set.call(this,k,v)});await act(async()=>{await expect(op.submit(body('plan-convert'))).rejects.toThrow('未能保存')});expect(api.plan).not.toHaveBeenCalled();vi.restoreAllMocks()
 Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});await act(async()=>{await expect(op.submit(body('plan-convert'))).rejects.toThrow('安全保存')});expect(api.plan).not.toHaveBeenCalled()
})
test('actor/endpoint变化阻迟到成功与GET；原identity保留',async()=>{
 await mount('plan-convert');let resolve!:(v:unknown)=>void;api.plan.mockImplementation(()=>new Promise(r=>{resolve=r}));let promise!:Promise<unknown>;await act(async()=>{promise=op.submit(body('plan-convert')).catch(e=>e)});await vi.waitFor(()=>expect(api.plan).toHaveBeenCalledOnce());const r=record()
 await act(async()=>useAuthStore.getState().login('other-synthetic',null,user(10)));await act(async()=>{resolve(ack(r));await promise});expect(saved()).toHaveLength(1);expect(op.confirmed).toBeNull();await act(async()=>{await expect(op.queryOriginal()).rejects.toThrow('账号')});expect(api.receipt).not.toHaveBeenCalled()
 useAuthStore.getState().login('synthetic',null,user());await remount('plan-convert');setApiClientBaseURL('http://other-synthetic.invalid/api');await act(async()=>{await expect(op.queryOriginal()).rejects.toThrow('服务器')});expect(api.receipt).not.toHaveBeenCalled()
})
test('隐藏再激活只有GET；换plan不显示别单ACK',async()=>{
 await mount('plan-convert');await fail('plan-convert');const r=record();await mount('plan-convert',7,false);await mount('plan-convert');expect(op.canRetry).toBe(false);api.receipt.mockResolvedValue({status:'not_found'});await act(async()=>{await expect(op.retry()).rejects.toThrow('重挂')});expect(api.plan).toHaveBeenCalledOnce()
 api.receipt.mockResolvedValue(receipt(r));await act(async()=>{await op.queryOriginal()});expect(op.confirmed?.queryOnly).toBe(true);await mount('plan-convert',8);expect(op.confirmed).toBeNull();expect(op.pending).toBeNull()
})
test('同tuple并发只一次POST；malformed记录阻另key',async()=>{
 await mount('plan-convert');let resolve!:(v:unknown)=>void;api.plan.mockImplementation(()=>new Promise(r=>{resolve=r}));let first!:Promise<unknown>;await act(async()=>{first=op.submit(body('plan-convert')).catch(e=>e)});await vi.waitFor(()=>expect(api.plan).toHaveBeenCalledOnce());await act(async()=>{await expect(op.submit(body('plan-convert',6))).rejects.toThrow('等待')});const r=record();await act(async()=>{resolve(ack(r));await first});expect(api.plan).toHaveBeenCalledOnce()
 const malformed='flowcube-procurement-intent-v1:request:'+encodeURIComponent(JSON.stringify([9,'http://synthetic.invalid/api','plan-convert',7,'malformed']));localStorage.setItem(malformed,'{}');await remount('plan-convert');expect(op.storageBlocked).toBe(true);await act(async()=>{await expect(op.submit(body('plan-convert'))).rejects.toBeTruthy()});expect(api.plan).toHaveBeenCalledOnce()
})

test('旧申请未决本地记录原样保留，计划转换不读取或重发它', async()=>{
 const legacyKey='flowcube-procurement-intent-v1:request:'+encodeURIComponent(JSON.stringify([9,'http://synthetic.invalid/api','requisition-create',0,'legacy-key']))
 localStorage.setItem(legacyKey,JSON.stringify({domain:'requisition-create',requestKey:'legacy-key'}))
 await mount('plan-convert')
 expect(op.pending).toBeNull();expect(api.plan).not.toHaveBeenCalled();expect(api.receipt).not.toHaveBeenCalled()
 expect(localStorage.getItem(legacyKey)).toBe(JSON.stringify({domain:'requisition-create',requestKey:'legacy-key'}))
})
