import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {convertPlanApi} from '@/api/procurement'
import {getOperationRequestStatusApi} from '@/api/operation-requests'
import {captureInboundEditOwner,inboundEditOwnerCurrent,inboundEditConfig,subscribeInboundEdit,inboundEditRevision,type InboundEditOwner} from './useInboundTaskEditRecovery'
import {useAuthStore} from '@/store/authStore'
import {hasPermission} from '@/lib/permissions'
import {PERMISSIONS,type PermissionCode} from '@/lib/permission-codes'
import {createRequestKey,withRequestKeyHeaders} from '@/lib/requestKey'
import {reserveTerminalSlot,completeTerminalSlot,cancelUnsentTerminalSlot,matchingCompactTerminal,assertTerminalReadyForPost,OPERATION_RETENTION_MS,OPERATION_CLOCK_MARGIN_MS,type TerminalReservation} from '@/lib/criticalTerminalStorage'

export type ProcurementIntentDomain='plan-convert'
export type ProcurementIntentBody={itemIds:number[]}
export interface PlanConverted {planId:number;planStatus:2|3;createdOrders:{purchaseOrderId:number;orderNo:string}[];requestFingerprint:string}
export interface ProcurementQuery {version:1;userId:number;baseURL:string;domain:ProcurementIntentDomain;action:string;path:string;method:'post';requestKey:string;createdAt:number;fingerprint:string;resourceId?:number;warehouseId?:number}
export interface ProcurementConfirmed {status:'success';data:PlanConverted;query:ProcurementQuery;queryOnly:boolean}
const PREFIX='flowcube-procurement-intent-v1:request:',TERMINAL='flowcube-procurement-intent-v1:terminal:'
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0
const validHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const stable=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v??null):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).filter(k=>(v as Record<string,unknown>)[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')}}`
export async function procurementIntentFingerprint(_domain:ProcurementIntentDomain,body:ProcurementIntentBody,resourceId=0){
  if(!crypto.subtle)throw Error('此客户端无法冻结原请求，本次没有发送')
  const payload={planId:resourceId,target:'purchase',itemIds:[...new Set((body as {itemIds:number[]}).itemIds.map(Number))].sort((a,b)=>a-b)}
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(payload)))
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')
}
const identity=(r:{userId:number|null;baseURL:string;domain:ProcurementIntentDomain;resourceId?:number})=>JSON.stringify([r.userId,r.baseURL,r.domain,r.resourceId??0])
const suffix=(r:ProcurementQuery)=>encodeURIComponent(JSON.stringify([r.userId,r.baseURL,r.domain,r.resourceId??0,r.requestKey]))
const key=(r:ProcurementQuery)=>PREFIX+suffix(r),terminal=(r:ProcurementQuery)=>TERMINAL+suffix(r)
const listeners=new Set<()=>void>(),flights=new Set<string>();let revision=0
const notify=()=>{revision++;listeners.forEach(fn=>fn())}
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}}
if(typeof window!=='undefined')window.addEventListener('storage',e=>{if(e.key===null||e.key?.startsWith(PREFIX)||e.key?.startsWith(TERMINAL))notify()})
function validQuery(v:unknown):v is ProcurementQuery{
  if(!object(v)||Object.keys(v).some(k=>!['version','userId','baseURL','domain','action','path','method','requestKey','createdAt','fingerprint','resourceId','warehouseId'].includes(k)))return false
  if(v.version!==1||!positive(v.userId)||typeof v.baseURL!=='string'||!v.baseURL||v.method!=='post'||typeof v.requestKey!=='string'||!v.requestKey||!positive(v.createdAt)||!validHash(v.fingerprint))return false
  return v.domain==='plan-convert'&&positive(v.resourceId)&&v.warehouseId===undefined&&v.action===`procurement.plan.convert.${v.resourceId}`&&v.path===`/procurement/plans/${v.resourceId}/convert`
}
function read(owner:InboundEditOwner,domain:ProcurementIntentDomain,resourceId?:number){
  const found:ProcurementQuery[]=[]
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i)!;if(!k.startsWith(PREFIX))continue
    const tuple:unknown=JSON.parse(decodeURIComponent(k.slice(PREFIX.length)))
    if(!Array.isArray(tuple)||tuple.length!==5)throw Error('原采购查询身份损坏，请保留记录并人工核对')
    if(stable(tuple.slice(0,4))!==identity({...owner,domain,resourceId}))continue
    const r:unknown=JSON.parse(localStorage.getItem(k)!)
    if(!validQuery(r)||key(r)!==k)throw Error('原采购查询身份不完整，请保留记录并核对')
    found.push(r)
  }
  if(found.length>1)throw Error('此入口存在多笔未决采购操作，请保留全部原键并人工核对')
  return found[0]??null
}
export function validProcurementResult(r:ProcurementQuery,data:unknown):data is PlanConverted{
  if(!object(data)||data.requestFingerprint!==r.fingerprint)return false
  return data.planId===r.resourceId&&[2,3].includes(Number(data.planStatus))&&typeof data.planStatus==='number'&&Array.isArray(data.createdOrders)&&data.createdOrders.length>0
    &&data.createdOrders.every(order=>object(order)&&positive(order.purchaseOrderId)&&typeof order.orderNo==='string'&&!!order.orderNo)
    &&new Set(data.createdOrders.map(order=>order.purchaseOrderId)).size===data.createdOrders.length
}
/** Domain query identity is durable; only this submitting view keeps the full original wire body. */
export function useProcurementIntentRecovery(domain:ProcurementIntentDomain,resourceId?:number,active=true){
  useSyncExternalStore(subscribe,()=>revision);useSyncExternalStore(subscribeInboundEdit,inboundEditRevision)
  const [owner]=useState(captureInboundEditOwner),mounted=useRef(true),running=useRef(false)
  const latest=useRef({domain,resourceId,active,serial:0})
  if(latest.current.domain!==domain||latest.current.resourceId!==resourceId||latest.current.active!==active)latest.current={domain,resourceId,active,serial:latest.current.serial+1}
  const serial=latest.current.serial
  const frozen=useRef<{query:ProcurementQuery;body:ProcurementIntentBody;serial:number}|null>(null),observed=useRef<ProcurementQuery|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState<ProcurementConfirmed|null>(null)
  const confirmedSerial=useRef<number|null>(null)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const current=()=>mounted.current&&latest.current.domain===domain&&latest.current.resourceId===resourceId&&latest.current.active&&latest.current.serial===serial&&inboundEditOwnerCurrent(owner)
  const readCurrent=()=>read(owner,domain,resourceId)
  const observedCurrent=()=>observed.current&&identity(observed.current)===identity({...owner,domain,resourceId})?observed.current:null
  let pending:ProcurementQuery|null=null,readError=''
  try{if(current()){pending=readCurrent();if(pending)observed.current=pending;else pending=observedCurrent()}}catch(e){readError=e instanceof Error?e.message:'原采购查询记录不可读取'}
  function capture(r?:ProcurementQuery){if(!current()||domain==='plan-convert'&&!positive(resourceId))throw Error('原账号、服务器、单据或页面已变化，请回原处查询');if(r&&(identity(r)!==identity({...owner,domain,resourceId})||stable(readCurrent()??observedCurrent())!==stable(r)))throw Error('原采购查询身份已变化，请保留记录并核对')}
  function mayWrite(){capture();const a=useAuthStore.getState(),can=(p:PermissionCode)=>hasPermission(a.user?.permissions,p,a.user?.roleId);if(!can(PERMISSIONS.PROCUREMENT_PLAN_MANAGE)||!can(PERMISSIONS.PURCHASE_ORDER_CREATE))throw Error('当前账号无此采购操作权限，请仅查询原结果')}
  async function perform<T>(fn:()=>Promise<T>){capture();const scope=identity({...owner,domain,resourceId});if(running.current||flights.has(scope))throw Error('正在处理原采购操作，请等待结果');if(!navigator.locks?.request)throw Error('此客户端无法安全保存原操作，本次没有发送');running.current=true;flights.add(scope);setBusy(true);setError('');try{return await navigator.locks.request('flowcube-procurement-intent:'+scope,async()=>{capture();return fn()})}catch(e){if(current())setError(e instanceof Error?e.message:'原采购结果待确认');throw e}finally{running.current=false;flights.delete(scope);if(mounted.current)setBusy(false);notify()}}
  async function finish(r:ProcurementQuery,state:'success'|'failed',data?:PlanConverted){capture(r);await completeTerminalSlot(terminal(r),r,state);capture(r);localStorage.removeItem(key(r));if(localStorage.getItem(key(r))!==null)throw Error('原结果已确认，但查询记录清理失败，请继续查询；禁止另键提交');const queryOnly=!frozen.current||frozen.current.serial!==serial||stable(frozen.current.query)!==stable(r);frozen.current=null;observed.current=null;notify();if(state==='success'&&data){const answer:ProcurementConfirmed={status:'success',data,query:r,queryOnly};confirmedSerial.current=serial;setConfirmed(answer);return answer}setError('本次明确未执行，可以修改后重新提交');return null}
  async function send(r:ProcurementQuery,reservation:TerminalReservation,first:boolean){capture(r);mayWrite();const original=frozen.current;if(!original||original.serial!==serial||stable(original.query)!==stable(r)||await procurementIntentFingerprint(domain,original.body,resourceId)!==r.fingerprint)throw Error('本页面没有完整原正文，仅可查询原结果');capture(r);mayWrite();assertTerminalReadyForPost(terminal(r),r,reservation);let received=false
    try{const config={...inboundEditConfig(owner),headers:withRequestKeyHeaders(r.requestKey)};const data=await convertPlanApi(r.resourceId!,(original.body as {itemIds:number[]}).itemIds,config);capture(r);if(!validProcurementResult(r,data))throw Error('采购结果无法证明完整原意图，请查询原结果');received=true;return await finish(r,'success',data)}catch(e){if(!current())throw e;const failure=e as {status?:number;code?:string;data?:{uncertain?:boolean}};if(!received&&first&&typeof failure.status==='number'&&failure.status>=400&&failure.status<500&&failure.status!==408&&failure.code!=='REQUEST_IN_PROGRESS'&&!failure.data?.uncertain&&(failure.status!==409||failure.code==='PROCUREMENT_COVERAGE_CHANGED'))await finish(r,'failed');throw e}
  }
  async function queryRecord(r:ProcurementQuery){capture(r);const marker=await matchingCompactTerminal(terminal(r),r),receipt=await getOperationRequestStatusApi(r.requestKey,r.action,{...inboundEditConfig(owner),params:{requestFingerprint:r.fingerprint,...(r.warehouseId?{warehouseId:r.warehouseId}:{})}});capture(r)
    if(receipt.status==='success'){if(receipt.resourceType!=='procurement_plan'||!validProcurementResult(r,receipt.data)||receipt.resourceId!==r.resourceId)throw Error('原结果与原采购意图或单据不一致，请保留原记录并人工核对');return await finish(r,'success',receipt.data)}
    setError(marker&&marker.state!=='reserved'?'原操作已有确认记录，暂不能读取详情，请只查询勿重发':receipt.status==='pending'?'原采购仍在处理中，请继续查询':receipt.status==='not_found'?'暂未查到原结果，不证明未执行；提交原页面可显式原键重试，重挂后仅可查询':'原失败记录没有完整正文证明，请保留原键并人工核对')
    return {status:receipt.status,marker}
  }
  const submit=(body:ProcurementIntentBody)=>perform(async()=>{mayWrite();if(readError||readCurrent()||observedCurrent())throw Error('原采购结果待确认，禁止换正文或另键提交');const original=JSON.parse(JSON.stringify(body)) as ProcurementIntentBody;if(!Array.isArray((original as {itemIds:number[]}).itemIds)||(original as {itemIds:number[]}).itemIds.length===0||!(original as {itemIds:number[]}).itemIds.every(positive))throw Error('原采购仓或选择明细不完整，未发送');const fingerprint=await procurementIntentFingerprint(domain,original,resourceId);capture();mayWrite();const r:ProcurementQuery={version:1,userId:owner.userId!,baseURL:owner.baseURL,domain,action:`procurement.plan.convert.${resourceId}`,path:`/procurement/plans/${resourceId}/convert`,method:'post',requestKey:createRequestKey(domain),createdAt:Date.now(),fingerprint,resourceId};const reservation=await reserveTerminalSlot(terminal(r),r)
    try{capture();mayWrite();if(localStorage.getItem(key(r))!==null)throw Error('原键已存在，禁止覆盖');const raw=JSON.stringify(r);localStorage.setItem(key(r),raw);if(localStorage.getItem(key(r))!==raw)throw Error('原查询身份未能保存，本次没有发送');notify()}catch(e){await cancelUnsentTerminalSlot(terminal(r),r);throw e}frozen.current={query:r,body:original,serial};observed.current=r;setConfirmed(null);return await send(r,reservation,true)
  })
  const recover=(retry:boolean)=>perform(async()=>{const r=readCurrent()??observedCurrent();if(!r)throw Error('没有待确认的原采购操作');const answer=await queryRecord(r);if(!answer||answer.status!=='not_found'||!retry)return answer;if(answer.marker&&answer.marker.state!=='reserved')return answer;if(!frozen.current||frozen.current.serial!==serial||stable(frozen.current.query)!==stable(r))throw Error('重挂后仅可查询原结果，不能重新发送');if(r.createdAt>Date.now()+OPERATION_CLOCK_MARGIN_MS||Date.now()-r.createdAt>=OPERATION_RETENTION_MS-OPERATION_CLOCK_MARGIN_MS)throw Error('原操作超出安全重试时限，仅可查询并人工核对');mayWrite();const reservation=await reserveTerminalSlot(terminal(r),r,true);return await send(r,reservation,false)})
  return {pending,busy,error:readError||error,confirmed:current()&&confirmedSerial.current===serial?confirmed:null,storageBlocked:!!readError,blocked:!!pending||busy||!!readError||!current(),canRetry:!!pending&&!!frozen.current&&frozen.current.serial===serial&&stable(frozen.current.query)===stable(pending)&&current(),submit,queryOriginal:()=>recover(false),retry:()=>recover(true)}
}
