'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {fixture,required,copy}=require('./helpers/supplier-refunds-fixture')
test('original PR gate refuses reserved refund before stock/payment but allows draft/received',async()=>{
 const f=fixture();const gate=required(f.module('pr-gate'),'assertNoPendingRefund')
 f.data.supplier_refund_allocations.push({purchase_return_id:11,budget_state:'reserved',amount:'1.0000'})
 await assert.rejects(gate(f.conn,11),e=>e.code==='SUPPLIER_REFUND_PENDING')
 f.data.supplier_refund_allocations[0].budget_state='draft';await gate(f.conn,11)
 f.data.supplier_refund_allocations[0].budget_state='received';await gate(f.conn,11)
 assert.equal(f.queries.some(q=>/FOR UPDATE|FOR SHARE/.test(q.sql)),false)
})

// Real legacy confirm/cancel wrappers. WMS/event/payment boundaries are explicit;
// the new refund gate and original PO→PR lock helper run their real functions.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const AppError=require('../backend/src/utils/AppError')
const ids=require('../backend/src/utils/sqlIdentifier')
const base=path.resolve(__dirname,'../backend/src')
function load(file,deps){const filename=path.join(base,file),module={exports:{}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:name=>{if(Object.hasOwn(deps,name))return deps[name];throw Error('Unstubbed actual PR '+name)}},{filename});return module.exports}
function original(f){
 f.returnEvents=[]
 const scope=load('utils/warehouseScope.js',{'../config/db':{},'./AppError':AppError})
 const transition=load('utils/statusTransition.js',{'./AppError':AppError,'./sqlIdentifier':ids})
 const status=load('constants/documentStatusRules.js',{'../utils/AppError':AppError})
 const wt=load('constants/warehouseTaskStatus.js',{'../utils/AppError':AppError})
 const lock=load('modules/returns/returns.purchase-lock.js',{'../../utils/AppError':AppError,'../../utils/warehouseScope':scope,'../../utils/statusTransition':transition})
 return load('modules/returns/returns-purchase.service.js',{
  '../../config/db':{pool:{getConnection:async()=>f.conn}},'../../utils/AppError':AppError,
  '../../utils/statusTransition':transition,'../../constants/documentStatusRules':status,
  './return-events.service':{RETURN_EVENT:{CONFIRMED:'confirmed',CANCELLED:'cancelled',CANCEL_REQUESTED:'cancelRequested'},record:async(_conn,event)=>{f.returnEvents.push(copy(event));f.events.push('return:event')}},
  '../../constants/warehouseTaskStatus':wt,'../../utils/requestContext':{getRequestId:()=>null},
  '../../utils/operationRequest':{},'./returns.helpers':{assertReturnPaymentHeadroom:async()=>f.events.push('AP:headroom')},
  '../../utils/warehouseScope':scope,'../../utils/unitConversion':{},'../../utils/pagination':{},'./returns.purchase-lock':lock,
  '../refunds/supplier-refunds.pr-gate':f.module('pr-gate'),
  '../warehouse-tasks/warehouse-tasks.service':{createForPurchaseReturn:async()=>{f.events.push('WT:new');return{taskId:81,taskNo:'WT81'}},cancel:async()=>{throw Error('no task cancel expected')}}
 })
}
for(const action of ['confirmPR','cancelPR'])test('actual original '+action+' rejects reserved RF before payment/status/task/event writes',async()=>{
 const f=fixture();f.data.supplier_refund_allocations.push({purchase_return_id:11,budget_state:'reserved',amount:'1.0000'})
 await assert.rejects(original(f)[action](11,{userId:9,realName:'fixture'},[8]),e=>e.code==='SUPPLIER_REFUND_PENDING')
 assert.equal(f.events.includes('AP:headroom'),false);assert.equal(f.events.includes('WT:new'),false);assert.equal(f.events.includes('return:event'),false);assert.equal(f.events.includes('commit'),false)
})

for(const action of ['confirmPR','cancelPR'])test('actual original '+action+' allows received history without payment undo and gives financial-review fact',async()=>{
 const f=fixture();f.data.supplier_refund_allocations.push({purchase_return_id:11,budget_state:'received',amount:'1.0000'})
 await original(f)[action](11,{userId:9,realName:'fixture'},[8])
 assert.equal(f.events.includes('commit'),true);assert.equal(f.returnEvents[0].payload.supplierRefundReceived,true);assert.match(f.returnEvents[0].payload.financialReview,/财务核对/);assert.match(f.returnEvents[0].description,/财务核对/);assert.equal(f.queries.some(q=>/UPDATE payment_|UPDATE finance_|party_ledger/.test(q.sql)),false)
})
