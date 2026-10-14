'use strict'
// Actual lockExecution/complete with finite SQL evidence; not native DB/commit.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path')
const AppError=require('../backend/src/utils/AppError'),cash=require('../backend/src/utils/cashMoney'),financial=require('../backend/src/modules/sale/sale.commercial-financial'),math=require('../backend/src/modules/sale/sale.commercial-money.math')
function load(file,deps){const filename=path.resolve(__dirname,'../backend/src',file),module={exports:{}};let code=fs.readFileSync(filename,'utf8');if(process.env.KIT_CASH_MUTANT==='ignore_actual')code=code.replace(/actualFinancial=allReceipts.reduce\([^\n]+?,0n\)/,'actualFinancial=financialTarget(context.basis,cash.cashText(beforeCents))');if(process.env.KIT_CASH_MUTANT==='foreign_context')code=code.replace('context[EXECUTION_CONNECTION]!==conn||','');vm.runInNewContext(code,{module,require:n=>{assert.ok(Object.hasOwn(deps,n),'Unstubbed '+n);return deps[n]}},{filename});return module.exports}
function fixture({prior=[],noAR=false,gross='.03',discount='.01',component='.03',qty=1,badBasis=false}={}){
 const rows=[],sql=[],basis={id:2,order_id:9,order_gross_basis:String(Number(gross)),discount_basis:String(Number(discount)),basis_origin:'real_confirmation',confirmed_at:'2026-10-14'}
 const conn={query:async(q,args=[])=>{sql.push({q,args})
  if(q.startsWith('SELECT DISTINCT sri.dispatch_component_id'))return [[{dispatch_component_id:1,return_id:20}]]
  if(q.startsWith('SELECT id,dispatch_group_id FROM sale_dispatch_component_money'))return [[{id:1,dispatch_group_id:2}]]
  if(q.startsWith('SELECT id FROM sale_dispatch_groups'))return [[{id:2},...(badBasis?[{id:3}]:[])]]
  if(q.startsWith('SELECT id,order_id,order_gross_basis'))return [[basis,...(badBasis&&args[0].includes(3)?[{...basis,id:3,discount_basis:'0.02'}]:[])]]
  if(q.startsWith('SELECT id,sale_order_id,cash_policy'))return [[{id:20,sale_order_id:9,cash_policy:'cash-cents-v1'}]]
  if(q.startsWith('SELECT id,return_item_id,checked_qty'))return [[{id:30,return_item_id:40,checked_qty:qty,rejected_qty:0,putaway_qty:qty}]]
  if(q.startsWith('SELECT sri.id,sri.dispatch_component_id'))return [[{id:40,dispatch_component_id:1,source_qty:3,confirmed_amount:String(Number(component)),order_id:9}]]
  if(q.startsWith('SELECT id,total_amount,paid_amount,balance'))return [noAR?[]:[{id:50,total_amount:'.02',paid_amount:0,balance:'.02'}].map(r=>({...r,total_amount:Number(r.total_amount),balance:Number(r.balance)}))]
  if(q.startsWith('SELECT refund_amount,financial_amount'))return [prior]
  if(q.startsWith('SELECT dispatch_component_id,return_task_item_id'))return [prior.map((r,i)=>({dispatch_component_id:1,return_task_item_id:100+i,qualified_qty:1,refund_amount:r.refund_amount}))]
  if(q.startsWith('SELECT id,checked_qty,rejected_qty,putaway_qty'))return [prior.map((r,i)=>({id:100+i,checked_qty:1,rejected_qty:0,putaway_qty:1}))]
  if(q.startsWith('INSERT INTO sale_commercial_refund_receipts')){rows.push(...args[0]);return [{affectedRows:args[0].length}]}
  if(q.startsWith('UPDATE sale_return_items')||q.startsWith('UPDATE sale_returns'))return [{affectedRows:1}]
  throw Error('Unexpected SQL '+q)
 }}
 const svc=load('modules/sale/sale.commercial-returns.js',{'../../utils/cashMoney':cash,'../../utils/AppError':AppError,'../../utils/warehouseScope':{},'../../utils/qtyPrecision':{},'../../utils/unitConversion':{roundQty:n=>Math.round(Number(n)*100)/100,round8:n=>Math.round(Number(n)*1e8)/1e8},'./sale.commercial-money.math':math,'./sale.commercial-refund-budget':{},'./sale.commercial-money':{invalid(reason){throw new AppError(reason,409,'SALE_COMMERCIAL_SOURCE_INVALID')}},'./sale.commercial-financial':financial})
 return {svc,conn,rows,sql}
}
test('actual kit completion uses saved exact-cent priorF, all three component refunds total net .02',async()=>{const prior=[],values=[];for(let i=0;i<3;i++){const f=fixture({prior}),ctx=await f.svc.lockExecution(f.conn,7),amount=await f.svc.complete(f.conn,20,7,ctx);values.push(amount);assert.equal(f.rows.length,1);prior.push({refund_amount:f.rows[0][7],financial_amount:f.rows[0][8]})}assert.deepEqual(values,[.01,0,.01]);assert.equal(prior.reduce((n,r)=>n+cash.storedCashCents(r.financial_amount),0n),2n)})
test('old actual .0067 cannot be silently rounded or consumed as inferred priorF',async()=>{const f=fixture({prior:[{refund_amount:'0.01',financial_amount:'0.0067'}]}),ctx=await f.svc.lockExecution(f.conn,7);await assert.rejects(f.svc.complete(f.conn,20,7,ctx),e=>e.statusCode===409);assert.equal(f.rows.length,0)})
test('cent-looking prior actual inconsistent with T(before) is review before receipt writes',async()=>{const f=fixture({prior:[{refund_amount:'0.01',financial_amount:'0.00'}]}),ctx=await f.svc.lockExecution(f.conn,7);await assert.rejects(f.svc.complete(f.conn,20,7,ctx),e=>e.statusCode===409);assert.equal(f.rows.length,0)})
test('zero gross physical component has cash0 without claiming missing AR is general mutex',async()=>{const f=fixture({noAR:true,gross:0,discount:0,component:0}),ctx=await f.svc.lockExecution(f.conn,7);assert.equal(await f.svc.complete(f.conn,20,7,ctx),0);assert.equal(f.rows[0][8],0)})
test('positive source budget without AR refuses and different-connection context has no authority',async()=>{const f=fixture({noAR:true}),ctx=await f.svc.lockExecution(f.conn,7);await assert.rejects(f.svc.complete(f.conn,20,7,ctx),e=>e.statusCode===409);await assert.rejects(f.svc.complete({query(){throw Error('No SQL')}},20,7,ctx),e=>e.statusCode===409);assert.equal(f.rows.length,0)})
test('known dispatch basis disagreement rejects pre-stock and locking queries use exact known PKs',async()=>{const f=fixture({badBasis:true});await assert.rejects(f.svc.lockExecution(f.conn,7),e=>e.statusCode===409);assert.ok(f.sql.filter(s=>/sale_dispatch_groups.*FOR SHARE/.test(s.q)).every(s=>s.q.includes('WHERE id IN (?)')));assert.equal(f.rows.length,0)})
test('new kit computed cash target supports zero, cents, and conservative cent draft bound',()=>{assert.equal(financial.financialTarget({orderGross:'0.03',discount:'0.01'},'0.01'),1n);assert.equal(financial.financialRefundEstimate({orderGross:'0.03',discount:'0.01'},'0.01'),.01);assert.equal(financial.financialTarget({orderGross:0,discount:0},0),0n)})
test('legacy period cut is proved equal or rejected before new shipment money',()=>{assert.doesNotThrow(()=>financial.assertLegacyCut({orderGross:'1.00',discount:'0.10'},'0.33'));assert.throws(()=>financial.assertLegacyCut({orderGross:'1.25',discount:'0.63'},'0.01'),e=>e.statusCode===409&&e.code==='CASH_LEGACY_PRECISION_REVIEW_REQUIRED')})
