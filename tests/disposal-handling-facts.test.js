'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {fixture,typeFixture}=require('./helpers/disposal-handling-fixture')
test('source detail explains E from all historical tasks, including deleted shipped task, without target permission',async()=>{
 const f=fixture(),view=await f.service.getSource(7,[8])
 assert.equal(view.budget.actualExecutedQuantity,2)
 assert.equal(view.links[0].executedQuantity,2)
 assert.equal(view.links[0].returnClosed,true)
 assert.equal(view.links[0].target,undefined)
 assert.ok(!JSON.stringify(view).includes('S81'))
 assert.ok(f.sqls.every(({sql})=>! /FOR SHARE|FOR UPDATE/.test(sql)))
})
test('valid target VIEW exposes identity only when complete current and historical warehouse scope permits',async()=>{
 const f=fixture(),view=await f.service.getSource(7,[8],{sale_order:true})
 assert.equal(view.links?.[0]?.target?.id,81)
 assert.equal(view.links[0].target.orderNo,'S81')
 f.state.warehouse_tasks[1].warehouse_id=9
 const denied=await f.service.getSource(7,[8],{sale_order:true})
 assert.equal(denied.links[0].target,undefined)
 assert.ok(!JSON.stringify(denied).includes('S81'))
})
for(const [label,change] of [
 ['missing retained shipping log',s=>s.inventory_logs=[]],
 ['dirty SKU candidate',s=>s.inventory_logs[0].product_id=4],
 ['dirty warehouse candidate',s=>s.inventory_logs[0].warehouse_id=9],
 ['wrong move candidate',s=>s.inventory_logs[0].move_type=13],
 ['duplicate WTI',s=>s.warehouse_task_items.push({...s.warehouse_task_items[0],id:603})],
 ['cancelled task has execution timestamp',s=>s.warehouse_tasks[1].shipped_at='2026-10-05'],
 ['deleted/inactive container is still locked',s=>s.inventory_containers.push({id:104,locked_by_task_id:22,status:0,deleted_at:'2026-10-05'})],
 ['cancelled box still waiting return',s=>s.packages[1].status=2],
]) test(`source detail retains pending rather than freeing allocation: ${label}`,async()=>{
 const f=fixture();change(f.state);const view=await f.service.getSource(7,[8])
 assert.equal(view.budget.availableQuantity,4)
 assert.equal(view.links?.[0]?.returnClosed,false)
 assert.ok(view.links[0].pendingReason?.code)
 assert.ok(!JSON.stringify(view.links[0].pendingReason).includes('WT21'))
})
test('multiple container shipping fragments sum once; untyped equal numeric IDs are not task evidence',async()=>{
 const f=fixture();f.state.inventory_logs[0].quantity=0.75
 f.state.inventory_logs.push({...f.state.inventory_logs[0],id:72,quantity:1.25,container_id:102},{...f.state.inventory_logs[0],id:73,quantity:999,ref_type:'purchase',ref_id:21,ref_no:'OTHER',log_source_type:'purchase',log_source_ref_id:21})
 const view=await f.service.getSource(7,[8]);assert.equal(view.budget.actualExecutedQuantity,2);assert.equal(view.links[0].returnClosed,true)
})
for(const [label,change,closed] of [
 ['strong cancelled un-dispatched',()=>{},true],
 ['missing current line',s=>s.sale_order_items=[],false],
 ['bad permanent payload hash',s=>s.disposal_handling_operations[0].payload_hash='bad',false],
 ['unexpected head task pointer',s=>s.sale_orders[0].task_id=99,false],
]) test(`no-task E0 proof: ${label}`,async()=>{
 const f=fixture();f.state.warehouse_tasks=[];f.state.warehouse_task_items=[];f.state.inventory_logs=[];f.state.packages=[]
 Object.assign(f.state.sale_orders[0],{status:5,task_id:null});Object.assign(f.state.sale_order_items[0],{quantity:6,shipped_qty:0,dispatched_qty:0,reserved_qty:0})
 change(f.state);const view=await f.service.getSource(7,[8]);assert.equal(view.links?.[0]?.returnClosed,closed);assert.equal(view.links[0].executedQuantity,closed?0:null)
})
const {uuid,rules}=require('./helpers/disposal-handling-fixture')
test('PR needs its cancelled head, accurate PRI→POI source and exact task link; WT8 picked is not E',async()=>{
 const f=typeFixture('purchase_return'),view=await f.service.getSource(7,[8],{purchase_return:true})
 assert.equal(view.links[0].executedQuantity,0);assert.equal(view.links[0].returnClosed,true);assert.equal(view.links[0].target.orderNo,'PR81')
 f.state.purchase_returns[0].status=2;const open=await f.service.getSource(7,[8]);assert.equal(open.links[0].returnClosed,false);assert.equal(open.links[0].executedQuantity,0)
 f.state.purchase_returns[0].status=4;f.state.warehouse_task_items[0].purchase_return_item_id=null
 const dirty=await f.service.getSource(7,[8]);assert.equal(dirty.links[0].executedQuantity,null);assert.equal(dirty.links[0].returnClosed,false)
 f.state.warehouse_task_items[0].purchase_return_item_id=501;f.state.purchase_order_items[0].order_id=92
 assert.equal((await f.service.getSource(7,[8])).links[0].executedQuantity,null)
})
test('PR shipping TASK_OUT is sale_task but remains accurately owned by return_id',async()=>{
 const f=typeFixture('purchase_return');Object.assign(f.state.warehouse_tasks[0],{status:7,shipped_at:'2026-10-05'});f.state.purchase_returns[0].status=3
 f.state.inventory_logs=[{id:71,move_type:8,type:2,product_id:3,warehouse_id:8,quantity:6,ref_type:'warehouse_task',ref_id:22,ref_no:'WT22',log_source_type:'sale_task',log_source_ref_id:22}]
 const view=await f.service.getSource(7,[8]);assert.equal(view.links[0].executedQuantity,6);assert.equal(view.links[0].returnClosed,true)
})
test('scrap E is proven by exact single SKU ledger + DISPOSAL log, while reject/cancel requires neither',async()=>{
 const f=typeFixture('inventory_disposal'),view=await f.service.getSource(7,[8]);assert.equal(view.links[0].executedQuantity,6);assert.equal(view.links[0].returnClosed,true)
 f.state.inventory_logs=[];assert.equal((await f.service.getSource(7,[8])).links[0].executedQuantity,null)
 f.state.inventory_disposal_orders[0].status=6;f.state.inventory_disposal_orders[0].disposed_at=null;f.state.disposal_scrapped=[]
 assert.equal((await f.service.getSource(7,[8])).links[0].executedQuantity,0)
 f.state.inventory_logs=[{id:72,move_type:13,type:2,product_id:4,warehouse_id:8,quantity:6,ref_type:'disposal',ref_id:81,ref_no:'D81',log_source_type:'disposal',log_source_ref_id:81}]
 assert.equal((await f.service.getSource(7,[8])).links[0].executedQuantity,null)
})
test('fact queries remain constant for multiple links and use same caller connection without locks',async()=>{
 const f=fixture();f.state.disposal_handling_sources[0].quantity=100
 await f.service.getSource(7,[8]);const count=f.sqls.filter(q=>q.sql.startsWith('SELECT')).length;f.sqls.length=0
 for(let n=2;n<=5;n++){
  const l={...f.state.disposal_handling_links[0],id:30+n,target_id:80+n,target_line_id:500+n,created_operation_uuid:uuid(100+n)}
  const response={id:l.target_id,orderNo:`S${l.target_id}`},op={...f.state.disposal_handling_operations[0],operation_uuid:l.created_operation_uuid,target_id:l.target_id,target_line_id:l.target_line_id,resource_id:l.target_id,response_json:rules.stableJson(response)}
  const body=JSON.parse(op.payload_json);body.disposalSource.operationUuid=l.created_operation_uuid;op.payload_json=rules.stableJson(body);op.payload_hash=rules.fingerprint(op.payload_json);l.response_json=op.response_json
  f.state.disposal_handling_links.push(l);f.state.disposal_handling_operations.push(op)
  f.state.sale_orders.push({...f.state.sale_orders[0],id:l.target_id,order_no:response.orderNo,disposal_handling_link_id:l.id,status:5,task_id:null})
  f.state.sale_order_items.push({...f.state.sale_order_items[0],id:l.target_line_id,order_id:l.target_id,quantity:6,reserved_qty:0,shipped_qty:0,dispatched_qty:0})
 }
 const view=await f.service.getSource(7,[8]);assert.equal(view.links.length,5);assert.equal(f.sqls.filter(q=>q.sql.startsWith('SELECT')).length,count)
 assert.ok(f.sqls.every(q=>!/FOR SHARE|FOR UPDATE|JOIN/.test(q.sql)));assert.equal(view.budget.actualExecutedQuantity,2)
})
test('quantity beyond frozen A in a cancelled task cannot masquerade as nonexecuted zero',async()=>{
 const f=fixture();f.state.warehouse_task_items[1].required_qty=100;f.state.warehouse_task_items[1].picked_qty=100
 const view=await f.service.getSource(7,[8]);assert.equal(view.links[0].executedQuantity,null);assert.equal(view.links[0].returnClosed,false)
})
test('source employee progress separates ordinary planned/partial/complete/terminal/unverified facts',async()=>{
 const f=fixture();assert.equal((await f.service.getSource(7,[8])).budget.progress,'目标终止待解除')
 f.state.sale_orders[0].status=3;assert.equal((await f.service.getSource(7,[8])).budget.progress,'部分执行')
 f.state.warehouse_tasks=[f.state.warehouse_tasks[1]];f.state.warehouse_task_items=[f.state.warehouse_task_items[1]];f.state.inventory_logs=[]
 assert.equal((await f.service.getSource(7,[8])).budget.progress,'已关联待执行')
 f.state.inventory_logs=[{id:73,ref_type:'warehouse_task',ref_id:22,ref_no:'WT22',log_source_type:'sale_task',log_source_ref_id:22,quantity:1,move_type:8,type:2,product_id:3,warehouse_id:8}]
 assert.equal((await f.service.getSource(7,[8])).budget.progress,'待核对')
})
test('all intended Q truly executed is complete, not merely all linked heads terminal',async()=>{
 const f=fixture();f.state.disposal_handling_sources[0].quantity=6;f.state.warehouse_tasks=[f.state.warehouse_tasks[0]];f.state.warehouse_task_items=[f.state.warehouse_task_items[0]];f.state.packages=[f.state.packages[0]]
 f.state.warehouse_task_items[0].required_qty=6;f.state.warehouse_task_items[0].picked_qty=6;f.state.inventory_logs[0].quantity=6
 Object.assign(f.state.sale_order_items[0],{quantity:6,shipped_qty:6,reserved_qty:6,dispatched_qty:6})
 const view=await f.service.getSource(7,[8]);assert.equal(view.budget.progress,'完成');assert.equal(view.budget.actualExecutedQuantity,6)
})
test('normal no-task draft has known unexecuted progress but cannot use cancellation release proof',async()=>{
 const f=fixture();f.state.warehouse_tasks=[];f.state.warehouse_task_items=[];f.state.inventory_logs=[];f.state.packages=[]
 Object.assign(f.state.sale_orders[0],{status:1,task_id:null});Object.assign(f.state.sale_order_items[0],{quantity:6,reserved_qty:0,dispatched_qty:0,shipped_qty:0})
 const view=await f.service.getSource(7,[8]);assert.equal(view.budget.progress,'已关联待执行');assert.equal(view.links[0].executedQuantity,0);assert.equal(view.links[0].returnClosed,false)
})
test('PR full completion E=A closes execution with R0; completed head with E<A stays unverified',async()=>{
 const f=typeFixture('purchase_return');Object.assign(f.state.warehouse_tasks[0],{status:7,shipped_at:'2026-10-05'});f.state.purchase_returns[0].status=3
 f.state.inventory_logs=[{id:71,move_type:8,type:2,product_id:3,warehouse_id:8,quantity:6,ref_type:'warehouse_task',ref_id:22,ref_no:'WT22',log_source_type:'sale_task',log_source_ref_id:22}]
 assert.equal((await f.service.getSource(7,[8])).links[0].returnClosed,true)
 f.state.warehouse_task_items[0].picked_qty=2;f.state.inventory_logs[0].quantity=2
 const short=await f.service.getSource(7,[8]);assert.equal(short.links[0].returnClosed,false);assert.equal(short.links[0].executedQuantity,null)
})
for(const status of [2,6])test(`normal no-task SO${status} retains reservation without pretending return closed`,async()=>{
 const f=fixture();f.state.warehouse_tasks=[];f.state.warehouse_task_items=[];f.state.inventory_logs=[];f.state.packages=[]
 Object.assign(f.state.sale_orders[0],{status,task_id:null});Object.assign(f.state.sale_order_items[0],{quantity:6,reserved_qty:6,shipped_qty:0,dispatched_qty:0})
 const view=await f.service.getSource(7,[8]);assert.equal(view.links[0].executedQuantity,0);assert.equal(view.links[0].returnClosed,false);assert.equal(view.budget.progress,'已关联待执行')
 f.state.sale_orders[0].status=3;assert.equal((await f.service.getSource(7,[8])).links[0].executedQuantity,null)
})
test('PR draft without WT is planned E0; confirmed PR without its mandatory WT remains unverified',async()=>{
 const f=typeFixture('purchase_return');f.state.warehouse_tasks=[];f.state.warehouse_task_items=[];f.state.purchase_returns[0].status=1
 const view=await f.service.getSource(7,[8]);assert.equal(view.links[0].executedQuantity,0);assert.equal(view.links[0].returnClosed,false);assert.equal(view.budget.progress,'已关联待执行')
 f.state.purchase_returns[0].status=2;assert.equal((await f.service.getSource(7,[8])).links[0].executedQuantity,null)
})
test('canonical original create body retains UUID case while matching normalized operation identity',async()=>{
 const f=fixture(),op=f.state.disposal_handling_operations[0],body=JSON.parse(op.payload_json)
 // Real UUID case normalization contract, including hex letters.
 const normalized='abcdefab-0000-4000-8000-000000000003'
 op.operation_uuid=normalized;f.state.disposal_handling_links[0].created_operation_uuid=normalized
 body.disposalSource.operationUuid=normalized.toUpperCase();op.payload_json=rules.stableJson(body);op.payload_hash=rules.fingerprint(op.payload_json)
 assert.equal((await f.service.getSource(7,[8])).links[0].executedQuantity,2)
})
test('no-WT cancelled SO proof requires real task pointer and explicit shipped/dispatched/reserved fields',async()=>{
 for(const field of ['task_id','shipped_qty','dispatched_qty','reserved_qty']){
  const f=fixture();f.state.warehouse_tasks=[];f.state.warehouse_task_items=[];f.state.inventory_logs=[];f.state.packages=[]
  Object.assign(f.state.sale_orders[0],{status:5,task_id:null});Object.assign(f.state.sale_order_items[0],{quantity:6,shipped_qty:0,dispatched_qty:0,reserved_qty:0})
  delete (field==='task_id'?f.state.sale_orders[0]:f.state.sale_order_items[0])[field]
  const view=await f.service.getSource(7,[8]);assert.equal(view.links[0].executedQuantity,null);assert.equal(view.links[0].returnClosed,false)
 }
})

for(const allCancelled of [false,true]) test(`SO4 without positive WT7 debit is unverified: ${allCancelled?'all historical WT8':'only cancelled WT22 remains'}`,async()=>{
 const f=fixture(),s=f.state
 s.inventory_logs=[]
 if(allCancelled){s.warehouse_tasks.forEach(t=>{t.status=8;t.shipped_at=null});s.packages.forEach(p=>p.status=3)}
 else{s.warehouse_tasks=s.warehouse_tasks.filter(t=>t.id===22);s.warehouse_task_items=s.warehouse_task_items.filter(i=>i.task_id===22);s.packages=s.packages.filter(p=>p.warehouse_task_id===22)}
 const view=await f.service.getSource(7,[8])
 assert.equal(view.links[0].executedQuantity,null);assert.equal(view.links[0].returnClosed,false);assert.equal(view.links[0].pendingReason.code,'EXECUTION_UNVERIFIED')
 assert.equal(view.budget.availableQuantity,4);assert.equal(s.sale_order_items[0].shipped_qty,2,'current projection cannot replace missing historical debit')
})

test('PR4 with accurately shipped WT7 E2 is inconsistent, not cancelled E0 or releasable remainder',async()=>{
 const f=typeFixture('purchase_return'),s=f.state
 Object.assign(s.warehouse_tasks[0],{status:7,shipped_at:'2026-10-05'});s.warehouse_task_items[0].picked_qty=2
 s.inventory_logs=[{id:71,move_type:8,type:2,product_id:3,warehouse_id:8,quantity:2,ref_type:'warehouse_task',ref_id:22,ref_no:'WT22',log_source_type:'sale_task',log_source_ref_id:22}]
 const view=await f.service.getSource(7,[8]);assert.equal(view.links[0].returnClosed,false);assert.equal(view.links[0].executedQuantity,null)
 assert.equal(view.links[0].pendingReason.code,'EXECUTION_UNVERIFIED');assert.equal(view.budget.availableQuantity,4)
})
