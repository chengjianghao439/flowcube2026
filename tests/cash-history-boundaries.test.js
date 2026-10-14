'use strict'
// Actual service functions, finite in-memory SQL only; no DB/auth/socket imports.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const AppError=require('../backend/src/utils/AppError'),cash=require('../backend/src/utils/cashMoney'),money=require('../backend/src/utils/decimalMoney')
const {fixture:baseFixture,input,uuid,seedLegacyCash,copy}=require('./helpers/supplier-refunds-receive-fixture')
function transform(source){
 if(process.env.CASH_HISTORY_MUTANT==='rt_scope_late')source=source.replaceAll('  await assertTaskMoneyScope(conn,taskId,scopeWarehouseIds,pdaWarehouseId)','')
 if(process.env.CASH_HISTORY_MUTANT==='shared_parser')source=source.replace('rules.frozenCreateBody(body)','rules.createBody(body)')
 if(process.env.CASH_HISTORY_MUTANT==='metadata_gate')source=source.replace('if (openingChanged) {',"storedCashCents(acc.opening_balance, '账户原期初余额');if (openingChanged) {")
 if(process.env.CASH_HISTORY_MUTANT==='scope_late')source=source.replace("    await assertRefundInScope(pool, scopeWarehouseIds, id)\n    assertStatusAction('refundOrder', 'execute', target.status)\n    storedCashCents(target.amount, '原退款金额')","    storedCashCents(target.amount, '原退款金额')\n    await assertRefundInScope(pool, scopeWarehouseIds, id)\n    assertStatusAction('refundOrder', 'execute', target.status)")
 return source
}
function fixture(){return baseFixture({transformSource:transform})}
function load(file,deps,mutate=s=>s){const name=path.resolve(__dirname,'../backend/src',file),module={exports:{}};vm.runInNewContext(transform(mutate(fs.readFileSync(name,'utf8'))),{module,Date,require:n=>{assert.ok(Object.hasOwn(deps,n),'Unstubbed '+n);return deps[n]}},{filename:name});return module.exports}
test('new supplier refund accepts canonical wire zeros but rejects fractional cash before writes',async()=>{
 const f=fixture(),svc=f.module('service');await svc.create(input(),f.options)
 const bad={...input(9),amount:'0.0067',allocations:[{entryId:21,amount:'0.0067'}]},before=f.snapshot()
 await assert.rejects(svc.create(bad,f.options),e=>e.statusCode===400&&e.code==='CASH_PRECISION_INVALID');assert.deepEqual(f.data,before)
})
test('stored fractional supplier draft still GETs, recovers original ACK and cancels without cash',async()=>{
 const f=fixture(),svc=f.module('service');await svc.create(input(),f.options);seedLegacyCash(f,'0.0067')
 const row=await svc.findById(61,9);assert.equal(row.amount,'0.0067')
 const own=await svc.getOwnOperation(uuid(1),{action:'supplier.refund.create',requestKey:'fixed-key'},9);assert.equal(own.status,'success')
 await assert.rejects(svc.confirm(61,{operationUuid:uuid(2)},f.options),e=>e.statusCode===409&&e.code==='CASH_LEGACY_PRECISION_REVIEW_REQUIRED')
 await svc.cancel(61,{operationUuid:uuid(3)},f.options);assert.equal(f.data.supplier_refund_allocations[0].budget_state,'released')
 assert.equal(f.data.finance_account_transactions.filter(t=>t.biz_type===6).length,0)
})
test('stored received fractional supplier fact keeps raw detail and permanent old ACK',async()=>{
 const f=fixture(),svc=f.module('service');await svc.create(input(),f.options);await svc.confirm(61,{operationUuid:uuid(2)},f.options)
 await svc.receive(61,{operationUuid:uuid(3)},{...f.options,postCommit:async()=>{}});seedLegacyCash(f,'0.0067')
 const before=f.snapshot();assert.equal((await svc.findById(61,9)).amount,'0.0067')
 const own=await svc.getOwnOperation(uuid(3),{action:'supplier.refund.receive.61',requestKey:'fixed-key'},9);assert.equal(own.data.amount,'0.0067')
 assert.deepEqual(f.data,before)
})
function accountFixture(){const sql=[],row={id:1,opening_balance:'0.0001',current_balance:'0.0001'};const conn={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(q,args)=>{sql.push({q,args});if(q.startsWith('SELECT * FROM finance_accounts'))return [[copy(row)]];if(q.startsWith('UPDATE finance_accounts'))return [{affectedRows:1}];throw Error('Unexpected money projection '+q)}}
 const svc=load('modules/finance/finance-accounts.service.js',{'../../utils/decimalMoney':money,'../../utils/cashMoney':cash,'../../config/db':{pool:{getConnection:async()=>conn}},'../../utils/AppError':AppError,'../../utils/backendTime':{},'../../utils/codeGenerator':{},'../../utils/pagination':{}})
 return {svc,sql,row}}
test('legacy fractional account metadata edit and explicit identical amount preserve old money',async()=>{
 for(const openingBalance of [undefined,'0.0001']){const f=accountFixture();await f.svc.update(1,{name:'保留原账',type:1,isActive:false,openingBalance});assert.equal(f.sql.length,2);assert.equal(f.sql[1].args[5],'0.0001');assert.ok(!f.sql.some(s=>/SUM|current_balance=/.test(s.q))) }
})
test('account real monetary edit and adjustment still reject old fractional source',async()=>{
 const f=accountFixture();await assert.rejects(f.svc.update(1,{name:'x',type:1,openingBalance:'0.01'}),e=>e.statusCode===409)
 await assert.rejects(f.svc.adjust(1,{targetBalance:'0.01'},{}),e=>e.statusCode===409)
 assert.equal(f.sql.some(s=>s.q.startsWith('UPDATE')),false)
})
test('customer refund backfill denies wrong warehouse before raw stored amount and application writes',async()=>{
 let applications=0;const pool={query:async q=>q.includes('SELECT refund_no')?[[{amount:'0.0067',status:2,account_id:2}]]:[[{sale_order_id:1}]]}
 const svc=load('modules/refunds/refund-orders.service.js',{'../../utils/cashMoney':cash,'../../config/db':{pool},'../../utils/AppError':AppError,'../../utils/backendTime':{},'../../utils/codeGenerator':{},'../../utils/statusTransition':{},'../../utils/operationRequest':{},'../../constants/documentStatusRules':{assertStatusAction(){}},'../../utils/requestContext':{},'../payments/payment-events.service':{},'../payments/reconciliation-statements.service':{},'../finance/finance-accounts.service':{},'../../utils/pagination':{},'../../utils/saleDocumentScope':{async assertSaleDocumentInScope(){throw new AppError('范围拒绝',403,'WAREHOUSE_SCOPE_DENIED')}},'../accounting/finance-period.guard':{async tryRecordBackfillApplication(){applications++}}})
 await assert.rejects(svc.execute(1,{},[2],'key',{backfill:{mode:'apply'}}),e=>e.statusCode===403&&e.code==='WAREHOUSE_SCOPE_DENIED'&&!e.data?.rawAmount);assert.equal(applications,0)
})
test('RT receive/check/putaway deny wrong scope/PDA before money proof or RT locks',async()=>{
 const scope=load('utils/warehouseScope.js',{'../config/db':{},'./AppError':AppError})
 for(const action of ['receive','check','putaway'])for(const auth of [{scopeWarehouseIds:[2],pdaWarehouseId:1},{scopeWarehouseIds:[1],pdaWarehouseId:2},{scopeWarehouseIds:[1],pdaWarehouseId:null}]){
  const calls=[],conn={query:async q=>{calls.push(q);assert.equal(q,'SELECT warehouse_id FROM return_tasks WHERE id=? AND deleted_at IS NULL');return [[{warehouse_id:1}]]}}
  const moneyProof=()=>{throw new AppError('must not reveal',409,'CASH_LEGACY_PRECISION_REVIEW_REQUIRED',{rawAmount:'0.0067'})}
  const svc=load('modules/return-tasks/return-tasks.service.js',{'../../utils/unitConversion':{},'../../utils/qtyPrecision':{},'../../config/db':{},'../../utils/AppError':AppError,'../../engine/containerEngine':{CONTAINER_STATUS:{REJECTED:5}},'../../utils/codeGenerator':{},'../../utils/statusTransition':{lockStatusRow(){throw Error('No RT lock before scope')}},'../../utils/operationRequest':{},'../../utils/warehouseScope':scope,'./return-tasks.labels':{},'../sale/sale.ordinary-return-money':{lockReturn:moneyProof},'../sale/sale.commercial-returns':{lockExecution:moneyProof}})
  await assert.rejects(svc[action](conn,3,{productId:1,passedQty:1,...auth}),e=>e.statusCode===403&&!e.data?.rawAmount)
  assert.equal(calls.length,1)
 }
})
