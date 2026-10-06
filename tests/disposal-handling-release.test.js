'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {fixture}=require('./helpers/disposal-handling-fixture')
for(const type of ['purchase_return','sale_return_out']) for(const status of [6,7,8]) test(`${type} new ready key cannot resurrect status ${status}`,async()=>{
 const f=fixture();Object.assign(f.state.warehouse_tasks[0],{task_type:type,status,deleted_at:null})
 await assert.rejects(f.pick.readyToShipWithinTransaction(f.conn,21,{requestKey:'new',userId:9,scopeWarehouseIds:[8]}),e=>e.statusCode===409)
 assert.equal(f.state.warehouse_tasks[0].status,status);assert.ok(!f.calls.includes('closure'))
})
for(const type of ['purchase_return','sale_return_out']) test(`${type} terminal task can still return original ready ACK without closure or status mutation`,async()=>{
 const f=fixture();Object.assign(f.state.warehouse_tasks[0],{task_type:type,status:8,deleted_at:null});f.setReplay({taskId:21,status:6})
 const ack=await f.pick.readyToShipWithinTransaction(f.conn,21,{requestKey:'old',userId:9,scopeWarehouseIds:[8]})
 assert.equal(ack.taskId,21);assert.equal(ack.status,6);assert.equal(f.state.warehouse_tasks[0].status,8);assert.ok(!f.calls.includes('closure'))
})
const {uuid,rules}=require('./helpers/disposal-handling-fixture')
const input={operationUuid:uuid(10),expectedRevision:2,reason:'剩余实物已按原任务归还'}
const options={requestKey:'release-key',operator:{userId:9,realName:'夹具'},authorization:{view:true,create:true,approve:false},scopeWarehouseIds:[8]}
const release=(f,body=input,opts=options)=>f.service.releaseLink(7,31,body,opts)
test('partial close releases absolute A-E once on same RC connection and freezes original minimal ACK',async()=>{
 const f=fixture(),ack=await release(f)
 assert.deepEqual(JSON.parse(JSON.stringify(ack)),{sourceId:7,linkId:31,executedQuantity:2,releasedQuantity:4,revision:3})
 assert.equal(f.state.disposal_handling_links[0].state,'TERMINATED');assert.equal(f.state.disposal_handling_sources[0].revision,3)
 assert.equal(f.calls.filter(x=>x==='begin').length,1);assert.equal(f.calls.filter(x=>x==='commit').length,1)
 const locks=f.sqls.filter(q=>/FOR SHARE|FOR UPDATE/.test(q.sql));assert.ok(locks[0].sql.includes('disposal_handling_sources'))
 assert.ok(locks[1].sql.includes('sale_orders'));assert.ok(locks[2].sql.includes('disposal_handling_links'))
 assert.ok(!locks.some(q=>/warehouse_tasks|warehouse_task_items|inventory_containers|packages/.test(q.sql)))
 const view=await f.service.getSource(7,[8]);assert.equal(view.budget.availableQuantity,8);assert.equal(view.budget.actualExecutedQuantity,2)
})
test('original permanent ACK survives revision change, generic TTL absence and shipping log TTL without second commit',async()=>{
 const f=fixture(),ack=await release(f);f.state.disposal_handling_sources[0].revision=8;f.state.inventory_logs=[];f.state.sale_order_items=[]
 const pos=f.sqls.length,again=await release(f);assert.equal(rules.stableJson(again),rules.stableJson(ack));assert.equal(f.calls.filter(x=>x==='commit').length,1)
 assert.ok(!f.sqls.slice(pos).some(q=>q.sql.includes('inventory_logs')))
 const view=await f.service.getSource(7,[8]);assert.equal(view.budget.actualExecutedQuantity,2);assert.equal(view.budget.availableQuantity,8)
})
for(const [name,body,opts] of [
 ['key',input,{...options,requestKey:'different'}],['body',{...input,reason:'不同说明'},options],['actor',input,{...options,operator:{userId:10,realName:'另一人'}}],
]) test(`permanent operation UUID cannot be reused with changed ${name}`,async()=>{
 const f=fixture();await release(f);await assert.rejects(release(f,body,opts),e=>e.code==='DISPOSAL_HANDLING_OPERATION_CONFLICT')
 assert.equal(f.state.disposal_handling_operations.length,2)
})
for(const boundary of ['link','revision','operation']) test(`release ${boundary} failure rolls back source/link/permanent operation together`,async()=>{
 const f=fixture(),before=rules.stableJson(f.state);f.fail[boundary]=true
 await assert.rejects(release(f),e=>e.statusCode===409);assert.equal(rules.stableJson(f.state),before);assert.ok(!f.calls.includes('commit'))
})
for(const [name,change] of [
 ['still locked container',s=>s.inventory_containers.push({id:104,locked_by_task_id:22,status:0,deleted_at:'gone'})],
 ['task cancel flag',s=>s.warehouse_tasks[1].cancel_requested_at='pending'],
 ['shipping log TTL absent',s=>s.inventory_logs=[]],
]) test(`unclosed facts do not release or create a durable operation: ${name}`,async()=>{
 const f=fixture();change(f.state);const before=rules.stableJson(f.state);await assert.rejects(release(f),e=>e.code==='DISPOSAL_HANDLING_RELEASE_PENDING');assert.equal(rules.stableJson(f.state),before)
})
test('current complete warehouse scope and current source manage permission apply before replay',async()=>{
 const f=fixture();await release(f);f.state.warehouse_tasks[1].warehouse_id=9
 const pos=f.sqls.length;await assert.rejects(release(f),e=>e.statusCode===403);assert.ok(!f.sqls.slice(pos).some(q=>q.sql.startsWith('INSERT INTO disposal_handling_operations')))
 f.state.warehouse_tasks[1].warehouse_id=8;await assert.rejects(release(f,input,{...options,authorization:{view:true,create:false}}),e=>e.statusCode===403)
})
test('authenticated exact own release result remains queryable after VIEW/CREATE withdrawal, never target metadata',async()=>{
 const f=fixture(),ack=await release(f)
 const query={operationUuid:input.operationUuid,intentUuid:uuid(1),action:'disposal.handling.link.release.31',requestKey:'release-key',userId:9,scopeWarehouseIds:[8]}
 const own=await f.service.getOwnOperation(query);assert.equal(rules.stableJson(own.data),rules.stableJson(ack));assert.equal(own.resourceType,'disposal_handling_link');assert.equal(own.resourceId,31);assert.ok(!JSON.stringify(own).includes('S81'))
 assert.equal((await f.service.getOwnOperation({...query,userId:10})).status,'not_found')
 await assert.rejects(f.service.getOwnOperation({...query,action:'disposal.handling.link.release.32'}),e=>e.statusCode===409)
 await assert.rejects(f.service.getOwnOperation({...query,scopeWarehouseIds:[]}),e=>e.statusCode===403)
 f.state.disposal_handling_links[0].release_evidence_json='{}';await assert.rejects(f.service.getOwnOperation(query),e=>e.statusCode===409)
})
test('unsafe/extra release body and route IDs fail without a transaction',async()=>{
 for(const [id,body] of [['7e0',input],[7,{...input,origin:'ordinary'}],[7,{...input,reason:''}],[7,{...input,expectedRevision:'2'}]]){
  const f=fixture();await assert.rejects(f.service.releaseLink(id,31,body,options),e=>e.statusCode===400);assert.ok(!f.calls.includes('begin'))
 }
})
const {load}=require('./helpers/disposal-handling-fixture')
const {z}=require('../backend/node_modules/zod')
const permissions=require('../backend/src/constants/permissions').PERMISSIONS
function routes(){
 const rows=[],router={use:()=>{}}
 for(const method of ['get','post','put'])router[method]=(path,...handlers)=>rows.push({method,path,handlers})
 load('modules/disposal/disposal.routes.js',{express:{Router:()=>router},zod:{z},'./disposal.controller':{},'./disposal.handling.contracts':load('modules/disposal/disposal.handling.contracts.js',{zod:{z},'../../utils/AppError':require('../backend/src/utils/AppError'),'./disposal.handling.rules':rules}),'../../middleware/auth':{authMiddleware:()=>{},requirePermission:p=>({permission:p}),requireAnyPermission:p=>({any:p})},'../../constants/permissions':{PERMISSIONS:permissions},'../../utils/route':{validateBody:schema=>({schema})}})
 return rows
}
test('registered release requires source VIEW plus server CREATE/APPROVE and strict release DTO',()=>{
 const row=routes().find(r=>r.method==='post'&&r.path==='/handling-sources/:id/links/:linkId/release')
 assert.ok(row,'actual endpoint is registered');assert.equal(row.handlers[0].permission,permissions.INVENTORY_DISPOSAL_VIEW)
 assert.deepEqual(Array.from(row.handlers[1].any),[permissions.INVENTORY_DISPOSAL_CREATE,permissions.INVENTORY_DISPOSAL_APPROVE])
 const schema=row.handlers[2].schema;assert.ok(schema.safeParse(input).success)
 for(const value of [{...input,origin:'ordinary'},{...input,sourceId:7},{...input,reason:''},{...input,expectedRevision:0}])assert.equal(schema.safeParse(value).success,false)
})
test('real controller ignores client metadata/manage claims and passes only loaded permission decisions plus raw IDs',async()=>{
 const calls=[],req={params:{id:'7',linkId:'31'},body:{...input,targetViews:{sale_order:true}},query:{targetViews:{sale_order:true}},headers:{'x-request-key':'release-key'},user:{userId:9,warehouseIds:[8]}}
 const ctrl=load('modules/disposal/disposal.controller.js',{'./disposal.service':{},'./disposal.handling':{listSources:async x=>calls.push(x),releaseLink:async(...args)=>calls.push(args)},'../../utils/response':{successResponse:()=>{}},'../../utils/operator':{getOperatorFromRequest:()=>options.operator},'../../utils/requestKey':require('../backend/src/utils/requestKey'),'../../middleware/auth':{hasPermission:(r,p)=>{assert.equal(r,req);return [permissions.INVENTORY_DISPOSAL_VIEW,permissions.INVENTORY_DISPOSAL_CREATE].includes(p)}},'../../constants/permissions':{PERMISSIONS:permissions}})
 await ctrl.handlingSources(req,{},e=>{throw e});assert.equal(calls[0].targetViews?.sale_order,false)
 assert.equal(typeof ctrl.releaseHandlingLink,'function')
 await ctrl.releaseHandlingLink(req,{},e=>{throw e});assert.equal(calls[1][0],'7');assert.equal(calls[1][1],'31')
 assert.equal(calls[1][3].authorization.create,true);assert.equal(calls[1][3].authorization.approve,false)
})
function legacy(f){
 const s=f.state,source=s.disposal_handling_sources[0];source.legacy_disposal_id=91;source.legacy_disposal_item_id=901;source.created_operation_uuid=uuid(90)
 const head={id:91,disposal_no:'D91',warehouse_id:8,warehouse_name:'仓八',status:3,total_value:'54.0000',remark:null,operator_id:9,operator_name:'夹具',approved_by:10,approved_by_name:'批准人',approved_at:'2026-10-04T10:00:00.000Z',reject_reason:null,disposed_at:null,created_at:'2026-10-04T09:00:00.000Z',updated_at:'2026-10-04T10:00:00.000Z',deleted_at:null,disposal_handling_link_id:null}
 const items=[{id:901,disposal_id:91,product_id:3,product_code:'P3',product_name:'商品三',unit:'个',quantity:'10.00',unit_value:'5.0000',dispose_type:1,remark:null,created_at:head.created_at},{id:902,disposal_id:91,product_id:4,product_code:'P4',product_name:'商品四',unit:'个',quantity:'2.00',unit_value:'2.0000',dispose_type:3,remark:null,created_at:head.created_at}]
 const approval={approved_by:head.approved_by,approved_by_name:head.approved_by_name,approved_at:head.approved_at}
 const snapshotFingerprint=rules.fingerprint(rules.stableJson({version:1,head,items,approval}))
 const body={operationUuid:uuid(90),originalDisposalId:91,snapshotFingerprint,reason:'完整签认'},payload=rules.stableJson(body)
 const other={...source,id:8,intent_uuid:uuid(8),product_id:4,product_code:'P4',product_name:'商品四',handling_type:3,quantity:2,revision:1,legacy_disposal_item_id:902}
 s.disposal_handling_sources.push(other)
 const response={id:1,originalDisposalId:91,disposalNo:'D91',operationUuid:uuid(90),snapshotFingerprint,sources:[source,other].map(r=>({sourceId:r.id,intentUuid:r.intent_uuid,legacyItemId:r.legacy_disposal_item_id,handlingType:r.handling_type,productId:r.product_id,warehouseId:r.warehouse_id,unit:r.unit,quantity:r.quantity,revision:1}))},responseJson=rules.stableJson(response)
 for(const row of [source,other])Object.assign(row,{created_by:9,created_by_name:'夹具',request_key:'convert-key',payload_json:payload,payload_hash:rules.fingerprint(payload),response_json:responseJson})
 s.inventory_disposal_conversions=[{id:1,original_disposal_id:91,operation_uuid:uuid(90),signed_by:9,signed_by_name:'夹具',signed_at:'2026-10-04T11:00:00.000Z',reason:body.reason,original_head_json:rules.stableJson(head),original_items_json:rules.stableJson(items),approval_snapshot_json:rules.stableJson(approval),response_json:responseJson,payload_json:payload,payload_hash:rules.fingerprint(payload)}]
 s.disposal_handling_operations.push({operation_uuid:uuid(90),action:'disposal.handling.legacy.convert.91',actor_id:9,request_key:'convert-key',intent_uuid:null,payload_json:payload,payload_hash:rules.fingerprint(payload),response_json:responseJson,source_id:null,target_type:null,target_id:null,target_line_id:null,legacy_disposal_id:91,resource_type:'inventory_disposal_conversion',resource_id:1,status:1})
}
for(const field of ['operator_id','approved_by','approved_at']) test(`legacy source missing frozen ${field} cannot bypass original creator/approval gate`,async()=>{
 const f=fixture();legacy(f);const c=f.state.inventory_disposal_conversions[0],head=JSON.parse(c.original_head_json);delete head[field];c.original_head_json=rules.stableJson(head)
 await assert.rejects(release(f,input,{...options,authorization:{view:true,approve:true,create:false}}),e=>e.statusCode===409)
 assert.ok(!f.sqls.some(q=>q.sql.startsWith('INSERT INTO disposal_handling_operations')))
})
test('legacy release keeps original self-approve flag only, and canonical approval must match original head',async()=>{
 const f=fixture();legacy(f);const opts={...options,authorization:{view:true,approve:true}}
 await assert.rejects(release(f,input,opts),e=>e.code==='SELF_APPROVAL_DENIED')
 f.state.sys_users[0].allow_self_approve=1
 const c=f.state.inventory_disposal_conversions[0];c.approval_snapshot_json=rules.stableJson({approved_by:999,approved_by_name:'批准人',approved_at:'2026-10-04T10:00:00.000Z'})
 await assert.rejects(release(f,input,opts),e=>e.statusCode===409)
 c.approval_snapshot_json=rules.stableJson({approved_by:10,approved_by_name:'批准人',approved_at:'2026-10-04T10:00:00.000Z'})
 assert.equal((await release(f,input,opts)).releasedQuantity,4)
})
const {typeFixture}=require('./helpers/disposal-handling-fixture')
test('PR release holds accurate PO S before PR X; WT8 with head2 remains pending until real head4',async()=>{
 const f=typeFixture('purchase_return');f.state.purchase_returns[0].status=2
 await assert.rejects(release(f),e=>e.code==='DISPOSAL_HANDLING_RELEASE_PENDING')
 assert.equal(f.state.disposal_handling_links[0].state,'ACTIVE');assert.equal(f.state.disposal_handling_operations.length,1)
 f.state.purchase_returns[0].status=4;const ack=await release(f);assert.equal(ack.executedQuantity,0);assert.equal(ack.releasedQuantity,6)
 const locks=f.sqls.filter(q=>/FOR SHARE|FOR UPDATE/.test(q.sql)).map(q=>q.sql)
 assert.ok(locks.findIndex(q=>q.includes('purchase_orders'))<locks.findIndex(q=>q.includes('purchase_returns')))
})
test('scrap proved E=A freezes R0, cancel without physical facts releases A and identity drift rolls back',async()=>{
 const f=typeFixture('inventory_disposal'),ack=await release(f);assert.equal(ack.executedQuantity,6);assert.equal(ack.releasedQuantity,0)
 const c=typeFixture('inventory_disposal');Object.assign(c.state.inventory_disposal_orders[0],{status:6,disposed_at:null});c.state.disposal_scrapped=[];c.state.inventory_logs=[]
 assert.equal((await release(c)).releasedQuantity,6)
 const dirty=typeFixture('inventory_disposal');dirty.state.inventory_disposal_orders[0].disposal_handling_link_id=32
 await assert.rejects(release(dirty),e=>e.statusCode===409);assert.equal(dirty.state.disposal_handling_operations.length,1)
})
test('missing no-WT line remains valid create identity but is never enough to release zero execution',async()=>{
 const f=fixture();f.state.warehouse_tasks=[];f.state.warehouse_task_items=[];f.state.inventory_logs=[];f.state.packages=[];f.state.sale_order_items=[]
 Object.assign(f.state.sale_orders[0],{status:5,task_id:null});await assert.rejects(release(f),e=>e.code==='DISPOSAL_HANDLING_RELEASE_PENDING')
 f.state.sale_order_items=[{id:501,order_id:81,product_id:3,warehouse_id:8,unit:'个',quantity:6,shipped_qty:0,dispatched_qty:0,reserved_qty:0}]
 assert.equal((await release(f)).releasedQuantity,6)
})
test('changed action/resource identities and new revision/budget mismatch are not treated as original success',async()=>{
 const f=fixture();await assert.rejects(release(f,{...input,operationUuid:uuid(3)}),e=>e.code==='DISPOSAL_HANDLING_OPERATION_CONFLICT')
 await assert.rejects(release(f,{...input,expectedRevision:1}),e=>e.code==='DISPOSAL_HANDLING_REVISION_CHANGED')
 f.state.disposal_handling_sources[0].quantity=5;await assert.rejects(release(f),e=>e.statusCode===409);assert.ok(!f.calls.includes('commit'))
})
test('own pending/not-found/corrupt result never infers success and does not POST',async()=>{
 const f=fixture(),query={operationUuid:uuid(10),intentUuid:uuid(1),action:'disposal.handling.link.release.31',requestKey:'release-key',userId:9,scopeWarehouseIds:[8]}
 assert.equal((await f.service.getOwnOperation(query)).status,'not_found')
 f.state.disposal_handling_operations.push({operation_uuid:uuid(10),action:query.action,intent_uuid:uuid(1),actor_id:9,request_key:'release-key',status:0})
 assert.equal((await f.service.getOwnOperation(query)).status,'pending');f.state.disposal_handling_operations[1].status=2
 await assert.rejects(f.service.getOwnOperation(query),e=>e.statusCode===409);assert.ok(f.sqls.every(q=>q.sql.startsWith('SELECT')||q.sql.startsWith('SET ')||q.sql.startsWith('START ')))
})
test('completed PR exact current A and historical E=A can freeze only R0; partial E/head3 cannot free allocation',async()=>{
 const f=typeFixture('purchase_return');Object.assign(f.state.warehouse_tasks[0],{status:7,shipped_at:'2026-10-05'});f.state.purchase_returns[0].status=3
 f.state.inventory_logs=[{id:71,move_type:8,type:2,product_id:3,warehouse_id:8,quantity:6,ref_type:'warehouse_task',ref_id:22,ref_no:'WT22',log_source_type:'sale_task',log_source_ref_id:22}]
 assert.equal((await release(f)).releasedQuantity,0)
 const bad=typeFixture('purchase_return');Object.assign(bad.state.warehouse_tasks[0],{status:7,shipped_at:'2026-10-05'});bad.state.purchase_returns[0].status=3;bad.state.warehouse_task_items[0].picked_qty=2
 bad.state.inventory_logs=[{...f.state.inventory_logs[0],quantity:2}]
 await assert.rejects(release(bad),e=>e.code==='DISPOSAL_HANDLING_RELEASE_PENDING');assert.equal(bad.state.disposal_handling_links[0].state,'ACTIVE')
})
test('frozen release evidence missing task flags or exact WTI identity is corrupt, not a new zero/closed proof',async()=>{
 for(const field of ['cancel_requested_at','adjustment_requested_at']){
  const f=fixture();await release(f);const l=f.state.disposal_handling_links[0],proof=JSON.parse(l.release_evidence_json);delete proof.snapshot.tasks[0][field];l.release_evidence_json=rules.stableJson(proof)
  await assert.rejects(f.service.getOwnOperation({operationUuid:input.operationUuid,intentUuid:uuid(1),action:'disposal.handling.link.release.31',requestKey:'release-key',userId:9,scopeWarehouseIds:[8]}),e=>e.statusCode===409)
 }
})
test('frozen no-WT E0 proof cannot survive removal of explicit original task pointer or SOI zero fields',async()=>{
 for(const field of ['task_id','shipped_qty','dispatched_qty','reserved_qty']){
  const f=fixture();f.state.warehouse_tasks=[];f.state.warehouse_task_items=[];f.state.inventory_logs=[];f.state.packages=[]
  Object.assign(f.state.sale_orders[0],{status:5,task_id:null});Object.assign(f.state.sale_order_items[0],{quantity:6,shipped_qty:0,dispatched_qty:0,reserved_qty:0})
  await release(f);const l=f.state.disposal_handling_links[0],proof=JSON.parse(l.release_evidence_json)
  delete (field==='task_id'?proof.snapshot.head:proof.snapshot.lines[0])[field];l.release_evidence_json=rules.stableJson(proof)
  await assert.rejects(f.service.getOwnOperation({operationUuid:input.operationUuid,intentUuid:uuid(1),action:'disposal.handling.link.release.31',requestKey:'release-key',userId:9,scopeWarehouseIds:[8]}),e=>e.statusCode===409)
 }
})
test('source origin class and link state distinguish ordinary/legacy and frozen R0 without leaking legacy ID',async()=>{
 const f=typeFixture('inventory_disposal'),before=await f.service.getSource(7,[8]);assert.equal(before.originKind,'ordinary');assert.equal(before.links[0].state,'ACTIVE');assert.equal(before.links[0].releasedQuantity,0)
 await release(f);const after=await f.service.getSource(7,[8]);assert.equal(after.links[0].state,'TERMINATED');assert.equal(after.links[0].releasedQuantity,0)
 const old=fixture();legacy(old);const view=await old.service.getSource(7,[8]);assert.equal(view.originKind,'legacy');assert.ok(!Object.keys(view).some(k=>/legacy.*id/i.test(k)));assert.equal(view.links[0].target,undefined)
})

for(const allCancelled of [false,true]) test(`SO4 cannot release all A without a proved shipped task: ${allCancelled?'all WT8':'WT21 removed'}`,async()=>{
 const f=fixture(),s=f.state;s.inventory_logs=[]
 if(allCancelled){s.warehouse_tasks.forEach(t=>{t.status=8;t.shipped_at=null});s.packages.forEach(p=>p.status=3)}
 else{s.warehouse_tasks=s.warehouse_tasks.filter(t=>t.id===22);s.warehouse_task_items=s.warehouse_task_items.filter(i=>i.task_id===22);s.packages=s.packages.filter(p=>p.warehouse_task_id===22)}
 const before=rules.stableJson(s)
 await assert.rejects(release(f),e=>e.code==='DISPOSAL_HANDLING_RELEASE_PENDING');assert.equal(rules.stableJson(s),before);assert.ok(!f.calls.includes('commit'))
})
const legacyOptions={...options,authorization:{view:true,approve:true,create:false}}
const setConversionResponse=(f,text)=>{f.state.inventory_disposal_conversions[0].response_json=text;f.state.disposal_handling_operations.find(o=>o.operation_uuid===uuid(90)).response_json=text;for(const row of f.state.disposal_handling_sources)row.response_json=text}
const changeConversionResponse=(f,change)=>{const c=f.state.inventory_disposal_conversions[0],value=JSON.parse(c.response_json);setConversionResponse(f,rules.stableJson(change(value)??value))}
for(const [name,change] of [
 ['canonical null',f=>setConversionResponse(f,'null')],
 ['missing fixed DTO',f=>setConversionResponse(f,rules.stableJson({id:1,originalDisposalId:91}))],
 ['wrong conversion ID',f=>changeConversionResponse(f,v=>{v.id=2})],
 ['wrong original ID',f=>changeConversionResponse(f,v=>{v.originalDisposalId=92})],
 ['wrong no',f=>changeConversionResponse(f,v=>{v.disposalNo='D92'})],
 ['wrong operation UUID',f=>changeConversionResponse(f,v=>{v.operationUuid=uuid(91)})],
 ['wrong fingerprint',f=>changeConversionResponse(f,v=>{v.snapshotFingerprint='a'.repeat(64)})],
 ['missing old line source',f=>changeConversionResponse(f,v=>{v.sources.pop()})],
 ['duplicate old line source',f=>changeConversionResponse(f,v=>{v.sources[1]={...v.sources[0]}})],
 ['extra source',f=>changeConversionResponse(f,v=>{v.sources.push({...v.sources[0],sourceId:99,intentUuid:uuid(99),legacyItemId:999})})],
 ['wrong line mapping',f=>changeConversionResponse(f,v=>{v.sources[0].legacyItemId=902;v.sources[1].legacyItemId=901})],
 ['wrong immutable quantity',f=>changeConversionResponse(f,v=>{v.sources[0].quantity=6})],
 ['non-original revision',f=>changeConversionResponse(f,v=>{v.sources[0].revision=2})],
 ['wrong source product',f=>changeConversionResponse(f,v=>{v.sources[0].productId=4})],
 ['wrong source warehouse',f=>changeConversionResponse(f,v=>{v.sources[0].warehouseId=9})],
 ['wrong source unit',f=>changeConversionResponse(f,v=>{v.sources[0].unit='箱'})],
 ['unsorted sources',f=>changeConversionResponse(f,v=>{v.sources.reverse()})],
 ['current source wrong product snapshot',f=>{f.state.disposal_handling_sources[0].product_name='另一商品'}],
 ['missing stored old-line source',f=>{f.state.disposal_handling_sources.pop()}],
 ['extra stored source',f=>{f.state.disposal_handling_sources.push({...f.state.disposal_handling_sources[1],id:99,intent_uuid:uuid(99),legacy_disposal_item_id:999})}],
 ['source request key mismatch',f=>{f.state.disposal_handling_sources[0].request_key='other-key'}],
 ['source original response mismatch',f=>{f.state.disposal_handling_sources[0].response_json='null'}],
 ['missing successful conversion op',f=>{f.state.disposal_handling_operations.pop()}],
 ['wrong conversion op resource',f=>{f.state.disposal_handling_operations[1].resource_id=2}],
 ['wrong conversion op action',f=>{f.state.disposal_handling_operations[1].action='disposal.handling.legacy.convert.92'}],
 ['wrong conversion op actor',f=>{f.state.disposal_handling_operations[1].actor_id=10}],
 ['conversion snapshot drift',f=>{const c=f.state.inventory_disposal_conversions[0],head=JSON.parse(c.original_head_json);head.remark='changed';c.original_head_json=rules.stableJson(head)}],
]) test(`legacy authorization rejects incomplete original conversion identity: ${name}`,async()=>{
 const f=fixture();legacy(f);f.state.sys_users[0].allow_self_approve=1;change(f);const before=rules.stableJson(f.state)
 await assert.rejects(release(f,input,legacyOptions),e=>e.statusCode===409);assert.equal(rules.stableJson(f.state),before);assert.ok(!f.calls.includes('commit'))
 assert.ok(!f.sqls.some(q=>q.sql.startsWith('INSERT INTO disposal_handling_operations')))
})
test('complete legacy conversion freezes original DTO revision1 while current source revision advances',async()=>{
 const f=fixture();legacy(f);f.state.sys_users[0].allow_self_approve=1;f.state.disposal_handling_sources[0].revision=8
 const responseBefore=f.state.inventory_disposal_conversions[0].response_json,ack=await release(f,{...input,expectedRevision:8},legacyOptions)
 assert.equal(ack.revision,9);assert.equal(ack.releasedQuantity,4);assert.equal(f.state.inventory_disposal_conversions[0].response_json,responseBefore)
 assert.deepEqual(JSON.parse(responseBefore).sources.map(s=>s.revision),[1,1])
 const peerReads=f.sqls.filter(q=>q.sql.includes('FROM disposal_handling_sources')&&q.sql.includes('legacy_disposal_id'))
 assert.equal(peerReads.length,1);assert.ok(peerReads.every(q=>! /FOR SHARE|FOR UPDATE/.test(q.sql)), 'no peer source locks after sourceX')
})

test('PR4 cannot release A-E when its historical task has a proved positive debit',async()=>{
 const f=typeFixture('purchase_return'),s=f.state
 Object.assign(s.warehouse_tasks[0],{status:7,shipped_at:'2026-10-05'});s.warehouse_task_items[0].picked_qty=2
 s.inventory_logs=[{id:71,move_type:8,type:2,product_id:3,warehouse_id:8,quantity:2,ref_type:'warehouse_task',ref_id:22,ref_no:'WT22',log_source_type:'sale_task',log_source_ref_id:22}]
 const before=rules.stableJson(s)
 await assert.rejects(release(f),e=>e.code==='DISPOSAL_HANDLING_RELEASE_PENDING');assert.equal(rules.stableJson(s),before);assert.ok(!f.calls.includes('commit'))
})
for(const status of [4,8,7])for(const pointer of [987,0,'missing']) test(`PR WT${status} with sale pointer ${pointer} cannot explain E or authorize release`,async()=>{
 const f=typeFixture('purchase_return'),s=f.state,task=s.warehouse_tasks[0]
 task.status=status;s.purchase_returns[0].status=status===7?3:status===4?2:4
 if(pointer==='missing')delete task.sale_order_id;else task.sale_order_id=pointer
 if(status===7){task.shipped_at='2026-10-05';s.inventory_logs=[{id:71,move_type:8,type:2,product_id:3,warehouse_id:8,quantity:6,ref_type:'warehouse_task',ref_id:22,ref_no:'WT22',log_source_type:'sale_task',log_source_ref_id:22}]}
 const view=await f.service.getSource(7,[8]),before=rules.stableJson(s),readCommits=f.calls.filter(c=>c==='commit').length;let error
 try{await release(f)}catch(e){error=e}
 assert.equal(view.links[0].executedQuantity,null);assert.equal(view.links[0].returnClosed,false)
 assert.equal(error?.code,'DISPOSAL_HANDLING_RELEASE_PENDING');assert.equal(rules.stableJson(s),before);assert.equal(f.calls.filter(c=>c==='commit').length,readCommits,'release adds no commit after the read snapshot')
})
for(const pointer of [987,0,'missing']) test(`frozen cancelled PR evidence with sale pointer ${pointer} is corrupt rather than an original successful proof`,async()=>{
 const f=typeFixture('purchase_return');assert.equal(f.state.warehouse_tasks[0].sale_order_id,null)
 await release(f);const l=f.state.disposal_handling_links[0],evidence=JSON.parse(l.release_evidence_json)
 if(pointer==='missing')delete evidence.snapshot.tasks[0].sale_order_id;else evidence.snapshot.tasks[0].sale_order_id=pointer
 l.release_evidence_json=rules.stableJson(evidence)
 await assert.rejects(f.service.getOwnOperation({operationUuid:input.operationUuid,intentUuid:uuid(1),action:'disposal.handling.link.release.31',requestKey:'release-key',userId:9,scopeWarehouseIds:[8]}),e=>e.statusCode===409)
})
test('frozen PR3 fully shipped proof cannot be relabelled PR4 while retaining its WT7 and E',async()=>{
 const f=typeFixture('purchase_return'),s=f.state;s.purchase_returns[0].status=3;Object.assign(s.warehouse_tasks[0],{status:7,shipped_at:'2026-10-05'})
 s.inventory_logs=[{id:71,move_type:8,type:2,product_id:3,warehouse_id:8,quantity:6,ref_type:'warehouse_task',ref_id:22,ref_no:'WT22',log_source_type:'sale_task',log_source_ref_id:22}]
 assert.equal((await release(f)).releasedQuantity,0)
 const l=s.disposal_handling_links[0],evidence=JSON.parse(l.release_evidence_json);evidence.snapshot.head.status=4;l.release_evidence_json=rules.stableJson(evidence)
 await assert.rejects(f.service.getOwnOperation({operationUuid:input.operationUuid,intentUuid:uuid(1),action:'disposal.handling.link.release.31',requestKey:'release-key',userId:9,scopeWarehouseIds:[8]}),e=>e.statusCode===409)
})
