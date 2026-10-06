'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {fixture,required,input,uuid,copy}=require('./helpers/supplier-refunds-fixture')
const create=async(f,n=1)=>required(f.module('service'),'create')(input(n),f.options)
test('F1 actual create commits head allocations operation event once without money writes',async()=>{
 const f=fixture(),before=f.snapshot(),result=await create(f)
 assert.deepEqual(copy(result),{id:61,refundNo:f.data.supplier_refund_orders[0].refund_no,status:1})
 assert.equal(f.events.filter(e=>e==='commit').length,1)
 assert.equal(f.data.supplier_refund_allocations[0].budget_state,'draft')
 for(const table of ['payment_records','payment_entries','payment_receipts','finance_account_transactions','finance_accounts'])assert.deepEqual(f.data[table],before[table])
 const position=name=>f.events.indexOf(name)
 for(const gate of ['acct_companies:S','sys_users:S','sys_roles:S','purchase_orders:S','purchase_returns:X','finance_accounts:S','payment_records:X','payment_entries:S'])assert.ok(position(gate)>=0&&position(gate)<position('head:insert'),gate)
 assert.ok(position('purchase_orders:S')<position('purchase_returns:X'));assert.ok(position('finance_accounts:S')<position('payment_records:X'))
})
test('confirm reserves and original UUID ACK survives state/revision/TTL and stopped account',async()=>{
 const f=fixture();await create(f)
 const svc=f.module('service'),body={operationUuid:uuid(2)}
 const ack=await required(svc,'confirm')(61,body,f.options)
 assert.equal(f.data.supplier_refund_orders[0].status,2);assert.equal(f.data.supplier_refund_allocations[0].budget_state,'reserved')
 f.data.finance_accounts.find(r=>r.id===42).is_active=0;f.data.purchase_returns[0].status=4
 const writes=f.data.payment_record_events.length
 assert.deepEqual(copy(await svc.confirm(61,body,f.options)),copy(ack));assert.equal(f.data.payment_record_events.length,writes)
})
test('draft RF can cancel after original PR cancel and income account stops; no funds/AP changes',async()=>{
 const f=fixture();await create(f);f.data.purchase_returns[0].status=4;f.data.finance_accounts[1].is_active=0;f.data.finance_accounts[1].deleted_at='2026-10-02'
 const before=f.snapshot();await required(f.module('service'),'cancel')(61,{operationUuid:uuid(3),reason:'cancel draft'},f.options)
 assert.equal(f.data.supplier_refund_orders[0].status,4);assert.equal(f.data.supplier_refund_allocations[0].budget_state,'released');assert.deepEqual(f.data.payment_records,before.payment_records)
})
for(const boundary of ['inactive','roleMissing','scopeDenied','scopeFailure','noCreate','selfApprove'])test('current actor/permissions/scope fail closed '+boundary,async()=>{
 const f=fixture();await create(f)
 if(boundary==='inactive')f.data.sys_users[0].is_active=0
 if(boundary==='roleMissing')f.data.sys_roles.length=0
 if(boundary==='scopeDenied')f.data.user_warehouse_scope[0].warehouse_id=99
 if(boundary==='scopeFailure')f.fail.scope=true
 if(boundary==='noCreate')f.data.sys_role_permissions=f.data.sys_role_permissions.filter(r=>r.permission!=='supplier.refund.create')
 if(boundary==='selfApprove'){f.data.sys_users[0].role_id=1;f.data.sys_users[0].allow_self_approve=0;f.data.sys_roles=[{id:1}]}
 const svc=f.module('service');await assert.rejects(boundary==='selfApprove'?required(svc,'confirm')(61,{operationUuid:uuid(2)},f.options):required(svc,'cancel')(61,{operationUuid:uuid(3)},f.options))
 assert.equal(f.data.supplier_refund_orders[0].status,1)
})
for(const failure of ['head','alloc','event','operation'])test('same transaction rollback covers '+failure,async()=>{
 const f=fixture({fail:{[failure]:true}}),before=f.snapshot();required(f.module('service'),'create');await assert.rejects(create(f));assert.deepEqual(f.data,before);assert.equal(f.events.filter(e=>e==='commit').length,0)
})
for(const changed of ['key','body','actor','action','resource'])test('permanent UUID full identity rejects '+changed,async()=>{
 const f=fixture();await create(f);const body=input(),options={...f.options}
 if(changed==='key')options.requestKey='different'
 if(changed==='body')body.remark='different'
 if(changed==='actor'){f.data.sys_users.push({...f.data.sys_users[0],id:8});options.userId=8}
 if(changed==='action')f.data.supplier_refund_operations[0].action='wrong'
 if(changed==='resource')f.data.supplier_refund_operations[0].resource_id=999
 await assert.rejects(required(f.module('service'),'create')(body,options));assert.equal(f.data.supplier_refund_orders.length,1)
})
test('auth-only own permanent query retains original minimal ACK after write/view withdrawal',async()=>{
 const f=fixture();const ack=await create(f);f.data.sys_role_permissions=[]
 const read=await required(f.module('service'),'getOwnOperation')(uuid(1),{action:'supplier.refund.create',requestKey:'fixed-key'},9)
 assert.deepEqual(copy(read.data),copy(ack));assert.equal(read.resourceType,'supplier_refund_order');assert.equal(read.resourceId,61);assert.equal(JSON.stringify(read).includes('unit_price'),false)
})

test('100-character original key is retained while domain event uses a valid 36-character operation ID',async()=>{
 const f=fixture(),options={...f.options,requestKey:'k'.repeat(100)}
 const ack=await required(f.module('service'),'create')(input(),options)
 assert.equal(f.data.supplier_refund_operations[0].request_key.length,100)
 assert.equal(f.data.payment_record_events[0][8],uuid(1))
 assert.deepEqual(copy(await f.module('service').create(input(),options)),copy(ack))
})
test('draft/confirm/cancel never inspect period or call money writers; all gates use the same connection',async()=>{
 const f=fixture();await create(f);await f.module('service').confirm(61,{operationUuid:uuid(2)},f.options);await f.module('service').cancel(61,{operationUuid:uuid(3)},f.options)
 assert.equal(f.events.filter(e=>e==='commit').length,3)
 assert.equal(f.queries.some(q=>/acct_period|voucher|party_ledger|UPDATE payment_|UPDATE finance_|INSERT INTO finance_/.test(q.sql)),false)
 assert.ok(f.queries.filter(q=>q.sql.startsWith('SET TRANSACTION')).every(q=>q.sql==='SET TRANSACTION ISOLATION LEVEL READ COMMITTED'))
})
for(const defect of ['missingIncome','wrongCompany','frozenQuantity','frozenPrice','sourceHash','allocationHash','createACK'])test('true frozen identity drift denies cancel/replay '+defect,async()=>{
 const f=fixture();await create(f)
 if(defect==='missingIncome')f.data.finance_accounts=f.data.finance_accounts.filter(r=>r.id!==42)
 if(defect==='wrongCompany')f.data.finance_accounts[1].company_id=2
 if(defect==='frozenQuantity'){f.data.purchase_return_items[0].quantity='1.00';f.data.purchase_returns[0].total_amount='3.0000'}
 if(defect==='frozenPrice')f.data.purchase_order_items[0].unit_price='4.0000'
 if(defect==='sourceHash')f.data.supplier_refund_orders[0].source_fingerprint='0'.repeat(64)
 if(defect==='allocationHash')f.data.supplier_refund_allocations[0].source_snapshot_json='{}'
 if(defect==='createACK')f.data.supplier_refund_operations[0].response_json='{}'
 const before=f.snapshot();await assert.rejects(f.module('service').cancel(61,{operationUuid:uuid(3)},f.options));assert.deepEqual(f.data,before)
})
test('cancel reserved RF permits stopped income and mutable AP/receipt projections; releases only its own allocations',async()=>{
 const f=fixture();await create(f);await f.module('service').confirm(61,{operationUuid:uuid(2)},f.options)
 f.data.finance_accounts[1].is_active=0;f.data.payment_records[0].paid_amount='0.0000';f.data.purchase_returns[0].status=4
 f.data.supplier_refund_allocations.push({id:99,refund_id:99,payment_record_id:31,purchase_return_id:11,entry_id:21,amount:'1.0000',budget_state:'reserved'})
 const result=await f.module('service').cancel(61,{operationUuid:uuid(3)},f.options)
 assert.equal(result.status,4);assert.equal(f.data.supplier_refund_allocations[0].budget_state,'released');assert.equal(f.data.supplier_refund_allocations[1].budget_state,'reserved')
})
test('new confirmation cannot reserve after account stops or exact source budget is consumed',async()=>{
 for(const defect of ['income','budget']){
  const f=fixture();await create(f)
  if(defect==='income')f.data.finance_accounts[1].is_active=0
  else f.data.supplier_refund_allocations.push({id:99,refund_id:99,payment_record_id:31,purchase_return_id:11,entry_id:21,amount:'2.0001',budget_state:'received'})
  const before=f.snapshot();await assert.rejects(f.module('service').confirm(61,{operationUuid:uuid(2)},f.options));assert.deepEqual(f.data,before)
 }
})
test('own read keeps original ACK through mutable AP/receipt projection and fails current scope withdrawal',async()=>{
 const f=fixture();const ack=await create(f);f.data.payment_records[0].paid_amount='0.0000';f.data.payment_records[0].total_amount='99.0000';f.data.purchase_returns[0].status=4
 assert.deepEqual(copy((await f.module('service').getOwnOperation(uuid(1),{action:'supplier.refund.create',requestKey:'fixed-key'},9)).data),copy(ack))
 f.data.user_warehouse_scope[0].warehouse_id=99
 await assert.rejects(f.module('service').getOwnOperation(uuid(1),{action:'supplier.refund.create',requestKey:'fixed-key'},9),e=>e.code==='WAREHOUSE_SCOPE_DENIED')
})
test('same permanent UUID never synthesizes success from pending or missing operations',async()=>{
 const f=fixture();const svc=f.module('service');const missing=await svc.getOwnOperation(uuid(1),{action:'supplier.refund.create',requestKey:'fixed-key'},9)
 assert.equal(missing.status,'not_found');assert.equal(f.queries.some(q=>/^INSERT/.test(q.sql)),false)
 await create(f);Object.assign(f.data.supplier_refund_operations[0],{status:0,refund_id:null,resource_type:null,resource_id:null,response_json:null})
 const pending=await svc.getOwnOperation(uuid(1),{action:'supplier.refund.create',requestKey:'fixed-key'},9)
 assert.equal(pending.status,'pending');assert.equal(pending.data,undefined)
 await assert.rejects(create(f),e=>e.code==='SUPPLIER_REFUND_OPERATION_PENDING')
})
test('list count/page share snapshot and full PO/PR/RF warehouse authorization before LIMIT',async()=>{
 const f=fixture();await create(f)
 f.data.supplier_refund_orders.push({...f.data.supplier_refund_orders[0],id:62,warehouse_id:99})
 const start=f.events.length,page=await f.module('service').findAll({page:'1',pageSize:'1'},9)
 assert.equal(page.total,1);assert.equal(page.list.length,1);assert.equal(page.list[0].id,61)
 assert.equal(f.events.slice(start).filter(e=>e==='START TRANSACTION READ ONLY').length,1)
 assert.equal(f.events.slice(start).filter(e=>e==='commit').length,1)
 f.data.user_warehouse_scope[0].warehouse_id=99
 const empty=await f.module('service').findAll({},9);assert.equal(empty.total,0);assert.equal(empty.list.length,0)
 for(const query of [{page:''},{page:['1','2']},{pageSize:201}])await assert.rejects(f.module('service').findAll(query,9),e=>e.statusCode===400)
})
for(const read of ['list','detail'])for(const mysqlDate of [false,true])test(`RF ${read} exposes the exact Beijing business DATE as YYYY-MM-DD (${mysqlDate?'Date':'string'} projection)`,async()=>{
 const f=fixture(),body={...input(),refundDate:'2026-10-06'}
 await f.module('service').create(body,f.options)
 const before=f.snapshot(),query=f.conn.query
 // Inject Date after the fixture JSON clone, as the ordinary +08:00 mysql2 pool does.
 f.conn.query=async(sql,args)=>{
  const result=await query(sql,args)
  if(mysqlDate&&sql.includes('FROM supplier_refund_orders'))for(const row of result[0])if(row.refund_date)row.refund_date=new Date('2026-10-06T00:00:00+08:00')
  return result
 }
 const result=read==='list'?(await f.module('service').findAll({},9)).list[0]:await f.module('service').findById(61,9)
 assert.equal(result.refund_date,body.refundDate)
 assert.equal(copy(result).refund_date,body.refundDate,'HTTP JSON must retain the frozen YYYY-MM-DD identity')
 assert.equal(result.amount,body.amount)
 assert.deepEqual(f.snapshot(),before,'read DTO normalization must not rewrite frozen requests or business facts')
})
test('dedicated VIEW does not grant source/list without full original viewing permissions',async()=>{
 const f=fixture();await create(f);f.data.sys_role_permissions=f.data.sys_role_permissions.filter(r=>r.permission!=='payment.view')
 for(const read of [()=>f.module('service').findAll({},9),()=>f.module('service').getSource(11,9),()=>f.module('service').findById(61,9)])await assert.rejects(read(),e=>e.code==='SUPPLIER_REFUND_AUTH_DENIED')
})

test('actual refund number fits original FAT biz_no30, preserves full UUID identity and stable ACK',async()=>{
 const f=fixture();const ack=await create(f)
 assert.ok(ack.refundNo.length<=30,'original 141 FAT.biz_no is VARCHAR(30)')
 assert.match(ack.refundNo,/^RF[0-9A-Z]{25}$/)
 const expected='RF'+BigInt('0x'+uuid(1).replaceAll('-','')).toString(36).toUpperCase().padStart(25,'0')
 assert.equal(ack.refundNo,expected)
 assert.deepEqual(copy(await create(f)),copy(ack))
 const second=await create(f,2);assert.notEqual(second.refundNo,ack.refundNo);assert.equal(second.refundNo.length,27)
})


test('received RF cannot cancel or release received budget',async()=>{
 const f=fixture();await create(f);f.data.supplier_refund_orders[0].status=3;f.data.supplier_refund_allocations[0].budget_state='received'
 const before=f.snapshot();await assert.rejects(f.module('service').cancel(61,{operationUuid:uuid(3)},f.options))
 assert.deepEqual(f.data,before);assert.equal(f.data.supplier_refund_allocations[0].budget_state,'received')
})
