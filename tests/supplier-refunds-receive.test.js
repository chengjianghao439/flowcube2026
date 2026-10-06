'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {fixture,required,input,uuid,copy,money}=require('./helpers/supplier-refunds-receive-fixture')
async function prepared(options={}) {
  const f=fixture(options),service=f.module('service')
  await service.create(options.createBody||input(),f.options)
  await service.confirm(61,{operationUuid:uuid(2)},f.options)
  return f
}
const body=()=>({operationUuid:uuid(3)})
const locator=()=>({purchaseOrderId:10,purchaseReturnId:11,refundDate:'2026-10-01'})
async function receive(f,options={}) {
  return required(f.module('service'),'receive')(61,body(),{...f.options,...options})
}
function funds(f){return f.data.finance_account_transactions.filter(row=>row.biz_type===6)}
function receivedAck(f){return {id:61,refundNo:f.data.supplier_refund_orders[0].refund_no,status:3,fundTransactionId:71,amount:'4.0000',message:'回款已登记，凭证结果见详情'}}

test('F2 actual wrapper writes one IN, AP paid, ledger, event and permanent identical ACK',async()=>{
  const f=await prepared(),before=f.snapshot(),result=await receive(f)
  assert.deepEqual(copy(result),receivedAck(f))
  assert.equal(funds(f).length,1);assert.equal(funds(f)[0].direction,1);assert.equal(f.events.filter(e=>e==='cash:commit').length,1)
  assert.equal(funds(f)[0].operator_id,9);assert.equal(funds(f)[0].happened_at,'2026-10-01')
  assert.equal(f.data.finance_accounts.find(row=>row.id===42).current_balance,'4.0000')
  assert.equal(f.data.payment_records[0].paid_amount,'96.0000');assert.equal(f.data.payment_records[0].balance,'4.0000')
  assert.equal(f.data.payment_records[0].total_amount,before.payment_records[0].total_amount)
  assert.equal(f.data.supplier_refund_allocations[0].budget_state,'received')
  assert.equal(f.data.supplier_refund_orders[0].received_account_type,1)
  assert.equal(f.data.supplier_refund_orders[0].voucher_generate_error,'凭证待生成')
  assert.deepEqual(f.data.payment_entries,before.payment_entries);assert.deepEqual(f.data.payment_receipts,before.payment_receipts)
  assert.deepEqual(f.data.finance_account_transactions.filter(row=>row.biz_type!==6),before.finance_account_transactions)
  assert.equal(f.data.party_ledger_events.length,1)
})
test('income X precedes statement/AP and same-account complete FAT current read remains real',async()=>{
  const f=await prepared({mutate:d=>{d.payment_entries[0].account_id=42;d.finance_account_transactions[0].account_id=42}})
  const start=f.events.length;await receive(f);const events=f.events.slice(start)
  assert.ok(events.indexOf('finance_accounts:X')<events.indexOf('payment_records:X'))
  assert.ok(events.indexOf('payment_records:X')<events.indexOf('finance_account_transactions:X'))
  assert.equal(f.data.finance_accounts[1].current_balance,'-96.0000')
  assert.equal(f.queries.filter(q=>/finance_account_transactions.*FOR UPDATE/.test(q.sql)).every(q=>q.args[0]===42),true)
})
test('different payer account is never locked after AP; old OUT retained',async()=>{
  const f=await prepared(),start=f.queries.length;await receive(f)
  const locked=f.queries.slice(start).filter(q=>/finance_accounts.*FOR UPDATE|finance_account_transactions.*FOR UPDATE/.test(q.sql))
  assert.ok(locked.length>0);assert.ok(locked.every(q=>q.args[0]===42))
})
test('entry without statement snapshot refreshes its current month reconciliation members',async()=>{
  const f=await prepared({mutate:d=>{
    d.reconciliation_statements.push({id:81,type:1,status:2,deleted_at:null,total_amount:'100.0000',settled_amount:'100.0000',balance:'0.0000'})
    d.reconciliation_statement_items.push({id:91,statement_id:81,record_id:31})
  }})
  const start=f.events.length;await receive(f)
  assert.equal(f.data.payment_entries[0].statement_id,null)
  assert.equal(f.data.reconciliation_statements[0].settled_amount,'96.0000')
  assert.equal(f.data.reconciliation_statements[0].balance,'4.0000')
  assert.ok(f.events.slice(start).indexOf('reconciliation_statements:X')<f.events.slice(start).indexOf('payment_records:X'))
})
test('borrowed approved locator takes no pool or transaction lifecycle and first ordinary read follows RF X',async()=>{
  const f=await prepared(),mod=f.module('receive');required(mod,'receiveInTransaction')
  await f.conn.beginTransaction();const start=f.events.length,qStart=f.queries.length
  const ack=await mod.receiveInTransaction(f.conn,61,body(),{...f.options,locator:locator(),periodAlreadyLocked:true})
  assert.deepEqual(copy(ack),receivedAck(f))
  assert.equal(f.events.slice(start).some(e=>/pool:|^begin$|^commit$|^rollback$|^release$|^SET /.test(e)),false)
  const qs=f.queries.slice(qStart),first=qs.findIndex(q=>q.sql.startsWith('SELECT ')&&!/FOR SHARE|FOR UPDATE/.test(q.sql))
  assert.ok(first>=0);assert.ok(qs.slice(0,first).some(q=>q.sql.includes('acct_companies')&&q.sql.endsWith('FOR SHARE')))
  assert.ok(qs.slice(0,first).some(q=>q.sql==='SELECT * FROM supplier_refund_orders WHERE id=? FOR UPDATE'))
  assert.equal(f.data.supplier_refund_orders[0].status,2)
  await f.conn.commit();assert.equal(f.data.supplier_refund_orders[0].status,3)
})
for(const drift of ['po','pr','date'])test('borrowed immutable locator mismatch cannot write '+drift,async()=>{
  const f=await prepared(),mod=f.module('receive');required(mod,'receiveInTransaction')
  const fixed=locator();if(drift==='po')fixed.purchaseOrderId=99;if(drift==='pr')fixed.purchaseReturnId=99;if(drift==='date')fixed.refundDate='2026-10-02'
  await f.conn.beginTransaction();const before=f.snapshot()
  await assert.rejects(mod.receiveInTransaction(f.conn,61,body(),{...f.options,locator:fixed,periodAlreadyLocked:true}),e=>e.statusCode===409||e.code==='SUPPLIER_REFUND_SOURCE_INVALID'||e.code==='SUPPLIER_REFUND_OPERATION_CONFLICT')
  assert.deepEqual(f.data,before);assert.equal(funds(f).length,0);await f.conn.rollback()
})
for(const defect of ['actor','role','scope','scopeLoad','receivePermission','viewPermission'])test('current full authorization rejects new receive '+defect,async()=>{
  const f=await prepared();required(f.module('service'),'receive')
  if(defect==='actor')f.data.sys_users[0].is_active=0
  if(defect==='role')f.data.sys_roles=[]
  if(defect==='scope')f.data.user_warehouse_scope[0].warehouse_id=99
  if(defect==='scopeLoad')f.fail.scope=true
  if(defect==='receivePermission')f.data.sys_role_permissions=f.data.sys_role_permissions.filter(row=>row.permission!=='supplier.refund.receive')
  if(defect==='viewPermission')f.data.sys_role_permissions=f.data.sys_role_permissions.filter(row=>row.permission!=='payment.view')
  const before=f.snapshot();await assert.rejects(receive(f));assert.deepEqual(f.data,before)
})
for(const defect of ['ap','pr','entry'])test('one ten-thousandth above current budget rejects without clamp '+defect,async()=>{
  const f=await prepared();required(f.module('service'),'receive')
  if(defect==='ap')f.data.payment_records[0].paid_amount='3.9999'
  if(defect==='pr')f.data.supplier_refund_allocations.push({id:99,refund_id:99,payment_record_id:31,purchase_return_id:11,entry_id:21,amount:'2.0001',budget_state:'received'})
  if(defect==='entry')f.data.supplier_refund_allocations.push({id:99,refund_id:99,payment_record_id:31,purchase_return_id:99,entry_id:21,amount:'96.0001',budget_state:'received'})
  const before=f.snapshot();await assert.rejects(receive(f),e=>e.code==='SUPPLIER_REFUND_BUDGET_EXCEEDED');assert.deepEqual(f.data,before)
})
for(const failure of ['fund','balance','ap','allocStatus','statement','ledger','event','received','operation'])test('all money and source state rolls back on '+failure,async()=>{
  const f=await prepared({mutate:d=>{d.reconciliation_statements=[{id:81,type:1,status:2,deleted_at:null}];d.reconciliation_statement_items=[{id:91,statement_id:81,record_id:31}]}})
  required(f.module('service'),'receive');f.fail[failure]=true;const before=f.snapshot()
  await assert.rejects(receive(f),e=>e.message===failure+' fixture failure')
  assert.deepEqual(f.data,before);assert.equal(funds(f).length,0)
})
test('new closed business date refuses accurate period without suggesting fake date; old ACK remains',async()=>{
  const f=await prepared();required(f.module('service'),'receive');f.data.acct_periods[0].status=2
  await assert.rejects(receive(f),e=>e.code==='FINANCE_PERIOD_CLOSED'&&!e.message.includes('改用未结账的日期'))
  assert.equal(funds(f).length,0);f.data.acct_periods[0].status=1
  const ack=await receive(f);f.data.acct_periods[0].status=2;f.data.finance_accounts[1].is_active=0;f.data.purchase_returns[0].status=4
  assert.deepEqual(copy(await receive(f)),copy(ack));assert.equal(funds(f).length,1)
})
test('postcommit generation or save failure never changes fixed successful business DTO',async()=>{
  for(const name of ['generate','save']){
    const f=await prepared();let calls=0
    const result=await receive(f,{postCommit:async facts=>{calls++;assert.equal(funds(f).length,1);assert.equal(f.data.supplier_refund_orders[0].status,3);assert.equal(facts.id,61);throw Error(name+' failed')}})
    assert.deepEqual(copy(result),receivedAck(f));assert.equal(calls,1);assert.equal(funds(f).length,1)
    assert.equal(f.data.supplier_refund_orders[0].voucher_generate_error,'凭证待生成')
  }
})
test('own permanent received ACK needs current scope, no VIEW/WRITE, and has no prices or voucher result',async()=>{
  const f=await prepared(),ack=await receive(f);f.data.sys_role_permissions=[]
  const own=await f.module('service').getOwnOperation(uuid(3),{action:'supplier.refund.receive.61',requestKey:'fixed-key'},9)
  assert.deepEqual(copy(own.data),copy(ack));assert.equal(own.resourceType,'supplier_refund_order')
  assert.equal(JSON.stringify(own).includes('unitPrice'),false);assert.equal(JSON.stringify(own).includes('voucher_generate_error'),false)
  f.data.user_warehouse_scope[0].warehouse_id=99
  await assert.rejects(f.module('service').getOwnOperation(uuid(3),{action:'supplier.refund.receive.61',requestKey:'fixed-key'},9),e=>e.code==='WAREHOUSE_SCOPE_DENIED')
})
for(const drift of ['key','body','actor','resource','fund'])test('permanent received operation refuses full identity corruption '+drift,async()=>{
  const f=await prepared();await receive(f);const options={...f.options},raw=body()
  if(drift==='key')options.requestKey='other'
  if(drift==='body')raw.reason='changed'
  if(drift==='actor'){f.data.sys_users.push({...f.data.sys_users[0],id:8});options.userId=8}
  if(drift==='resource')f.data.supplier_refund_operations.find(row=>row.operation_uuid===uuid(3)).resource_id=999
  if(drift==='fund')f.data.supplier_refund_orders[0].fund_transaction_id=999
  const before=f.snapshot();await assert.rejects(f.module('service').receive(61,raw,options));assert.deepEqual(f.data,before)
})

test('F2 exactMoney opt-in keeps a lawful large multi-member one-ten-thousandth balance in actual refresh',async()=>{
  const f=fixture({mutate:d=>{
    d.reconciliation_statements=[{id:81,type:1,status:2,deleted_at:null}]
    d.reconciliation_statement_items=[{id:91,statement_id:81,record_id:31},{id:92,statement_id:81,record_id:32}]
    d.payment_records[0].total_amount='9999999998.0000';d.payment_records[0].paid_amount='9999999998.0000'
    d.payment_records.push({id:32,type:1,total_amount:'1.0001',paid_amount:'1.0000'})
  }})
  await f.conn.beginTransaction()
  const result=await f.external('../payments/reconciliation-statements.service').refreshSettlement(f.conn,81,{currentRead:true,exactMoney:true})
  assert.deepEqual(copy(result),{total:'9999999999.0001',paid:'9999999999.0000',balance:'0.0001',status:2})
  await f.conn.commit();assert.equal(f.data.reconciliation_statements[0].balance,'0.0001')
})

test('original reconciliation default/currentRead numeric DTO and draft rule stay compatible',async()=>{
  const f=fixture({mutate:d=>{d.reconciliation_statements=[{id:81,status:1}];d.reconciliation_statement_items=[{id:91,statement_id:81,record_id:31}]}})
  await f.conn.beginTransaction()
  const actual=f.external('../payments/reconciliation-statements.service')
  assert.deepEqual(copy(await actual.refreshSettlement(f.conn,81,{currentRead:true})),{total:100,paid:100,balance:0,status:1})
  assert.deepEqual(copy(await actual.refreshSettlement(f.conn,81,{currentRead:true,exactMoney:true})),{total:'100.0000',paid:'100.0000',balance:'0.0000',status:1})
  await f.conn.rollback()
})
test('current statement membership drift after candidate gates rolls back without chasing a new statement',async()=>{
  let armed=false,changed=false
  const f=await prepared({queryHook:({sql,state})=>{
    if(armed&&!changed&&sql==='SELECT * FROM payment_records WHERE id=? FOR UPDATE'){
      changed=true;state.reconciliation_statement_items.push({id:92,statement_id:82,record_id:31})
    }
  }})
  required(f.module('service'),'receive');armed=true
  const before=f.snapshot(),start=f.queries.length
  await assert.rejects(receive(f),e=>e.code==='SUPPLIER_REFUND_SOURCE_INVALID'&&e.message.includes('对账'))
  assert.deepEqual(f.data,before)
  assert.equal(f.queries.slice(start).some(q=>q.sql.includes('reconciliation_statements')&&q.sql.endsWith('FOR UPDATE')&&q.args[0]?.includes?.(82)),false)
})
test('receipt NULL entry account and independent numeric collision retain exact two-parent OUT evidence on receive',async()=>{
  const f=await prepared({createBody:{...input(),allocations:[{entryId:22,amount:'4.0000'}]},mutate:d=>{
    d.payment_records[0].paid_amount='200.0000';d.payment_records[0].total_amount='200.0000'
    d.payment_entries.push({id:22,record_id:31,amount:'100.0000',account_id:null,receipt_id:21,statement_id:null,payment_date:'2026-10-01'})
    d.payment_receipts.push({id:21,type:1,party_id:4,receipt_no:'PY21',account_id:41,amount:'100.0000',payment_date:'2026-10-01'})
    d.finance_account_transactions.push({id:52,account_id:41,direction:2,amount:'100.0000',biz_type:2,biz_id:21,biz_no:'PY21',happened_at:'2026-10-01'})
  }})
  await receive(f);assert.equal(funds(f).length,1)
  assert.equal(f.data.payment_entries[1].account_id,null)
  assert.equal(f.data.finance_account_transactions.filter(r=>r.biz_type===2).length,2)
})
test('actual borrowed postcommit boundary is explicit and never runs before caller commit',async()=>{
  const f=await prepared(),inner=f.module('receive');required(inner,'receiveInTransaction')
  await f.conn.beginTransaction();let calls=0
  const ack=await inner.receiveInTransaction(f.conn,61,body(),{...f.options,locator:locator(),periodAlreadyLocked:true})
  assert.equal(calls,0);assert.equal(f.data.supplier_refund_orders[0].status,2)
  await f.conn.commit()
  await required(f.module('postcommit'),'afterReceiveCommit')(ack,async dto=>{calls++;assert.equal(f.data.supplier_refund_orders[0].status,3);assert.deepEqual(copy(dto),receivedAck(f))})
  assert.equal(calls,1)
})

for(const defect of ['amount','direction','account','date','no','duplicate','missing'])test('own received ACK denies altered exact new IN evidence '+defect,async()=>{
  const f=await prepared();await receive(f)
  const fund=funds(f)[0]
  if(defect==='amount')fund.amount='3.9999'
  if(defect==='direction')fund.direction=2
  if(defect==='account')fund.account_id=41
  if(defect==='date')fund.happened_at='2026-10-02'
  if(defect==='no')fund.biz_no='wrong'
  if(defect==='duplicate')f.data.finance_account_transactions.push({...fund,id:72})
  if(defect==='missing')f.data.finance_account_transactions=f.data.finance_account_transactions.filter(row=>row.id!==71)
  await assert.rejects(f.module('service').getOwnOperation(uuid(3),{action:'supplier.refund.receive.61',requestKey:'fixed-key'},9),e=>e.code==='SUPPLIER_REFUND_OPERATION_CONFLICT')
})

test('actual large lawful 1000-member refresh avoids one-ten-thousandth Number accumulation drift',async()=>{
  const f=fixture({mutate:d=>{
    d.reconciliation_statements=[{id:81,type:1,status:2}]
    d.payment_records=Array.from({length:1000},(_,i)=>({id:i+1,type:1,total_amount:'9999999.9999',paid_amount:'9999999.9998'}))
    d.reconciliation_statement_items=d.payment_records.map(r=>({id:r.id,record_id:r.id,statement_id:81}))
  }})
  await f.conn.beginTransaction()
  const result=await f.external('../payments/reconciliation-statements.service').refreshSettlement(f.conn,81,{currentRead:true,exactMoney:true})
  assert.deepEqual(copy(result),{total:'9999999999.9000',paid:'9999999999.8000',balance:'0.1000',status:2})
  await f.conn.commit();assert.equal(f.data.reconciliation_statements[0].balance,'0.1000')
})

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const base=path.resolve(__dirname,'../backend/src')
function load(file,deps){
  const filename=path.join(base,file),module={exports:{}}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:name=>{
    if(Object.hasOwn(deps,name))return deps[name]
    throw Error('Unstubbed F2 entry/PR require '+name)
  }},{filename})
  return module.exports
}
test('registered receive POST uses actual parse and dedicated permission; own stays auth-only',()=>{
  const f=fixture(),stack=[],router={use:()=>{}}
  for(const method of ['get','post'])router[method]=(url,...middleware)=>stack.push({method,url,middleware})
  load('modules/refunds/supplier-refunds.routes.js',{
    express:{Router:()=>router},'./supplier-refunds.controller':new Proxy({}, {get:(_obj,key)=>({handler:key})}),
    './supplier-refunds.rules':f.module('rules'),'../../middleware/auth':{authMiddleware:()=>{},requirePermission:permission=>({permission})},
    '../../constants/permissions':require('../backend/src/constants/permissions'),'../../utils/route':require('../backend/src/utils/route'),
  })
  const entry=stack.find(r=>r.method==='post'&&r.url==='/:id/receive')
  assert.ok(entry);assert.equal(entry.middleware.find(m=>m.permission)?.permission,'supplier.refund.receive')
  assert.equal(stack.find(r=>r.url==='/operations/:uuid').middleware.some(m=>m.permission),false)
  const parse=entry.middleware.find(m=>typeof m==='function');let error,req={body:body()}
  parse(req,{},e=>{error=e});assert.equal(error,undefined);assert.equal(req.body.operationUuid,uuid(3))
  for(const forbidden of [{operationUuid:uuid(3),userId:88},{operationUuid:uuid(3),incomeAccountId:99},{operationUuid:uuid(3),backfillRequest:true},{}]){
    error=null;parse({body:forbidden},{},e=>{error=e});assert.equal(error.code,'SUPPLIER_REFUND_INPUT_INVALID')
  }
})
test('actual receive controller forwards authenticated userId and original key only',async()=>{
  const calls=[],service={receive:async(...args)=>{calls.push(args);return{id:61,status:3}}}
  const controller=load('modules/refunds/supplier-refunds.controller.js',{
    './supplier-refunds.service':service,'../../utils/response':require('../backend/src/utils/response'),'../../utils/requestKey':require('../backend/src/utils/requestKey'),
  })
  const response={status:()=>response,json:value=>value}
  await controller.receive({user:{userId:9,id:88},headers:{'x-request-key':'original'},params:{id:'61'},body:body()},response,e=>{throw e})
  assert.equal(calls.length,1);assert.equal(calls[0][0],'61');assert.equal(calls[0][1].operationUuid,uuid(3))
  assert.deepEqual(copy(calls[0][2]),{userId:9,requestKey:'original'})
})
function originalPR(f){
  const AppError=require('../backend/src/utils/AppError'),ids=require('../backend/src/utils/sqlIdentifier')
  const scope=load('utils/warehouseScope.js',{'../config/db':{},'./AppError':AppError})
  const transition=load('utils/statusTransition.js',{'./AppError':AppError,'./sqlIdentifier':ids})
  const status=load('constants/documentStatusRules.js',{'../utils/AppError':AppError})
  const wt=load('constants/warehouseTaskStatus.js',{'../utils/AppError':AppError})
  const lock=load('modules/returns/returns.purchase-lock.js',{'../../utils/AppError':AppError,'../../utils/warehouseScope':scope,'../../utils/statusTransition':transition})
  return load('modules/returns/returns-purchase.service.js',{
    '../../config/db':{pool:{getConnection:async()=>f.conn}},'../../utils/AppError':AppError,
    '../../utils/statusTransition':transition,'../../constants/documentStatusRules':status,
    './return-events.service':{RETURN_EVENT:{CANCELLED:'cancelled',CANCEL_REQUESTED:'cancelRequested'},record:async(conn,event)=>{assert.equal(conn,f.conn);assert.equal(event.payload.supplierRefundReceived,true);assert.match(event.description,/财务核对/)}},
    '../../constants/warehouseTaskStatus':wt,'../../utils/requestContext':{getRequestId:()=>null},'../../utils/operationRequest':{},
    './returns.helpers':{assertReturnPaymentHeadroom:async()=>{throw Error('cancel may not alter AP')}},
    '../../utils/warehouseScope':scope,'../../utils/unitConversion':{},'../../utils/pagination':{},'./returns.purchase-lock':lock,
    '../refunds/supplier-refunds.pr-gate':f.module('pr-gate'),
    '../warehouse-tasks/warehouse-tasks.service':{cancel:async()=>{throw Error('no warehouse task expected')}},
  })
}
test('actual original PR cancellation after received refund changes no money/AP and preserves review notice',async()=>{
  const f=await prepared();await receive(f);const before=f.snapshot()
  await originalPR(f).cancelPR(11,{userId:9,realName:'fixture'},[8])
  assert.equal(f.data.purchase_returns[0].status,4)
  for(const table of ['payment_records','payment_entries','payment_receipts','finance_account_transactions','finance_accounts','party_ledger_events'])assert.deepEqual(f.data[table],before[table])
  assert.deepEqual(copy(await receive(f)),receivedAck(f));assert.equal(funds(f).length,1)
})

test('borrowed original ACK survives VIEW/RECEIVE withdrawal and later closed date, no second money write',async()=>{
  const f=await prepared();const ack=await receive(f)
  f.data.sys_role_permissions=[];f.data.acct_periods[0].status=2
  await f.conn.beginTransaction()
  const same=await required(f.module('receive'),'receiveInTransaction')(f.conn,61,body(),{...f.options,locator:locator(),periodAlreadyLocked:true})
  assert.deepEqual(copy(same),copy(ack));await f.conn.commit();assert.equal(funds(f).length,1)
})
