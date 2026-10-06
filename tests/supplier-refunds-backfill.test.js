'use strict'
const {test,afterEach}=require('node:test')
const assert=require('node:assert/strict')
const {fixture,capability,assertNoModelErrors,copy,P,uuid}=require('./helpers/supplier-refunds-backfill-fixture')
afterEach(assertNoModelErrors)
const operator={operatorId:10,operatorName:'approver'}
const reason='原已结账期间的实际退款'
async function apply(f){return capability(f.load('backfill'),'request')(f.a.ack.id,f.body,{...f.options,reason})}
async function approveOnly(f){const app=await apply(f);Object.assign(f.data.finance_period_backfills[0],{status:1,approver_id:10,approved_at:f.approvedDate+' 23:59:59'});return app}
const funds=f=>f.data.finance_account_transactions.filter(t=>t.biz_type===6)

test('actual new kind guard keeps first approval date even after business period reopens',async()=>{
 const f=await fixture();f.data.acct_periods.find(p=>p.period==='202609').status=0
 const result=await f.load('guard').assertFinancePeriodOpen(f.f.conn,'2026-09-01',{backfill:{kind:'supplier_refund',postingDate:'2026-10-31',postingPeriod:'202610'}})
 assert.equal(result.voucherDateOverride,'2026-10-31');assert.ok(f.a.events.includes('company:X'))
})
for(const override of [{postingDate:null,postingPeriod:'202610'},{postingDate:'2026-02-30',postingPeriod:'202602'},{postingDate:'2026-10-31',postingPeriod:'202611'}])test('actual guard rejects malformed or mismatched approved posting date '+JSON.stringify(override),async()=>{
 const f=await fixture();await assert.rejects(f.load('guard').assertFinancePeriodOpen(f.f.conn,'2026-09-01',{backfill:{kind:'supplier_refund',...override}}));assert.equal(funds(f).length,0)
})
test('generic guard rejects missing saved approval date even after business period reopens',async()=>{
 const f=await fixture();f.data.acct_periods.find(p=>p.period==='202609').status=0
 await assert.rejects(f.load('guard').assertFinancePeriodOpen(f.f.conn,'2026-09-01',{backfill:{postingPeriod:'202610'}}),e=>e.code==='FINANCE_BACKFILL_APPROVAL_DATE_INVALID');assert.equal(funds(f).length,0)
})
test('actual application is durable full identity and writes no funds/AP before approval',async()=>{
 const f=await fixture();const start=f.f.events.length,prior=f.data.payment_records[0].paid_amount,app=await apply(f)
 assert.equal(app.id,81);assert.equal(app.status,0);assert.equal(funds(f).length,0);assert.equal(f.data.payment_records[0].paid_amount,prior)
 const row=f.data.finance_period_backfills[0],snap=JSON.parse(row.request_snapshot)
 assert.equal(snap.actorId,9);assert.equal(snap.body.reason,f.body.reason);assert.equal(snap.identity.payloadHash.length,64);assert.equal(row.payload_fingerprint.length,16)
 assert.ok(!f.events.includes('application:X'));assert.ok(!f.f.events.slice(start).includes('purchase_returns:X'))
})
test('same application key replay validates complete snapshot even if period reopens',async()=>{
 const f=await fixture();await apply(f);f.data.acct_periods.find(p=>p.period==='202609').status=0
 const again=await apply(f);assert.equal(again.id,81);assert.equal(again.reused,true);assert.equal(funds(f).length,0);assert.equal(f.data.finance_period_backfills.length,1)
 f.data.finance_period_backfills[0].request_snapshot=JSON.stringify({...JSON.parse(f.data.finance_period_backfills[0].request_snapshot),actorId:10})
 await assert.rejects(apply(f));assert.equal(f.data.finance_period_backfills.length,1)
})
for(const changes of [{body:{operationUuid:uuid(902)}},{options:{requestKey:'x'.repeat(65)}},{options:{userId:10}},{reason:'短'},{reason:'x'.repeat(301)}])test('application validates original identity/control limits '+JSON.stringify(changes),async()=>{
 const f=await fixture();capability(f.load('backfill'),'request');if(changes.body)f.body=changes.body;if(changes.options)f.options={...f.options,...changes.options}
 if(!changes.body&&!changes.options)await assert.rejects(capability(f.load('backfill'),'request')(61,f.body,{...f.options,reason:changes.reason}))
 else {if(changes.body){await apply(f);f.body={operationUuid:uuid(903)};await assert.rejects(apply(f))}else await assert.rejects(apply(f))}
 assert.equal(funds(f).length,0)
})
test('actual execute borrows one transaction and uses applicant not RF creator/approver',async()=>{
 const f=await fixture('4.0000',{creatorId:20});const app=await approveOnly(f),start=f.f.events.length
 const result=await f.load('service').execute(app.id,operator)
 assert.equal(f.data.supplier_refund_orders[0].created_by,20);assert.equal(f.data.finance_period_backfills[0].applicant_id,9)
 assert.equal(result.result.status,3);assert.equal(result.postingPeriod,'202610');assert.equal(funds(f).length,1)
 const fund=funds(f)[0];assert.equal(fund.operator_id,9);assert.equal(fund.happened_at,'2026-09-01');assert.equal(fund.voucher_date_override,'2026-10-31');assert.equal(fund.backfill_id,81)
 const business=f.f.events.slice(start);assert.equal(business.filter(e=>e==='begin').length,2,'one business + one postcommit proof transaction');assert.ok(f.events.indexOf('application:X')<f.events.indexOf('executed'))
 assert.equal(f.data.finance_period_backfills[0].posting_period,'202610');assert.equal(f.data.acct_vouchers[0].voucher_date,'2026-10-31')
 assert.equal(result.application.bizTypeName,'供应商退款');assert.equal(result.application.voucherPending,false)
})
for(const change of [row=>row.approved_at=null,row=>row.request_snapshot=JSON.stringify({...JSON.parse(row.request_snapshot),actorId:10}),row=>row.request_key='changed',row=>row.payload_fingerprint='0000000000000000'])test('execute denies invalid approved date or frozen application identity before money',async()=>{
 const f=await fixture(),app=await approveOnly(f);change(f.data.finance_period_backfills[0]);await assert.rejects(f.load('service').execute(app.id,operator));assert.equal(funds(f).length,0);assert.equal(f.data.finance_period_backfills[0].executed_at,null)
})
test('approved period later closed rejects without migrating month; business reopening cannot bypass',async()=>{
 const f=await fixture(),app=await approveOnly(f);f.data.acct_periods.find(p=>p.period==='202609').status=0;f.data.acct_periods.find(p=>p.period==='202610').status=2
 const start=f.queries.length
 await assert.rejects(f.load('service').execute(app.id,operator),e=>e.code==='FINANCE_BACKFILL_POSTING_PERIOD_CLOSED');assert.ok(!f.queries.slice(start).some(q=>/FROM purchase_orders|FROM purchase_returns|FROM supplier_refund_orders/.test(q.sql)),'approved-period refusal precedes every business head');assert.equal(funds(f).length,0);assert.equal(f.data.finance_period_backfills[0].status,1)
})
for(const mutate of [d=>d.sys_users[0].is_active=0,d=>d.sys_users[0].deleted_at='2026-10-30',d=>d.sys_users[0].role_id=3,d=>d.sys_role_permissions=d.sys_role_permissions.filter(p=>p.permission!==P.SUPPLIER_REFUND_RECEIVE),d=>d.user_warehouse_scope[0].warehouse_id=99])test('execute locks and checks current original applicant authorization/scope',async()=>{
 const f=await fixture(),app=await approveOnly(f);mutate(f.data);await assert.rejects(f.load('service').execute(app.id,operator));assert.equal(funds(f).length,0)
})
test('original backfill approval self rule has no role1 or allowSelfApprove exemption',async()=>{
 const f=await fixture();const app=await apply(f);await assert.rejects(f.load('service').approve(app.id,{operatorId:9,operatorName:'self'}),e=>e.code==='FINANCE_BACKFILL_SELF_APPROVE');assert.equal(funds(f).length,0)
})
for(const amount of ['0.0040','0.0050'])test('real postcommit result derives zero/generated from complete single RF proof '+amount,async()=>{
 const f=await fixture(amount),app=await approveOnly(f),result=await f.load('service').execute(app.id,operator)
 assert.equal(funds(f).length,1);assert.equal(funds(f)[0].amount,amount);assert.equal(result.application.voucherPending,false)
 if(amount==='0.0040'){assert.equal(result.application.voucherNotRequired,true);assert.equal(result.application.voucherResult,'notRequired');assert.equal(f.data.acct_vouchers.length,0);assert.match(result.application.voucherGenerateError,/零分/)}
 else {assert.equal(result.application.voucherResult,'generated');assert.deepEqual(f.data.acct_voucher_entries.map(e=>e.amount),['0.01','0.01'])}
})
for(const match of ['INSERT INTO finance_account_transactions','SET executed_at = NOW()'])test('receive or execution mark write failure rolls back entire borrowed business '+match,async()=>{
 const f=await fixture(),app=await approveOnly(f),before=copy(f.data);f.fail.match=match
 await assert.rejects(f.load('service').execute(app.id,operator));assert.deepEqual(f.data,before)
})
test('postcommit generation/save failure leaves successful cash and fixed ACK',async()=>{
 const f=await fixture(),app=await approveOnly(f);f.a.fail.match='INSERT INTO acct_vouchers'
 const result=await f.load('service').execute(app.id,operator);assert.equal(result.result.status,3);assert.equal(funds(f).length,1);assert.equal(f.data.payment_records[0].paid_amount,'96.0000');assert.ok(result.application.voucherPending)
})
test('本人 lookup remains read only after VIEW/receive withdrawal, exact application versus receive identity',async()=>{
 const f=await fixture(),app=await apply(f);f.data.sys_role_permissions=[]
 const result=await capability(f.load('backfill'),'lookupOwn')(f.body.operationUuid,{requestKey:f.options.requestKey,action:'supplier.refund.receive.61'},9)
 assert.equal(result.id,app.id);assert.equal(result.status,0);assert.equal(result.executed,false);assert.ok(!Object.hasOwn(result,'amount'));assert.equal(funds(f).length,0)
 await assert.rejects(f.load('backfill').lookupOwn(f.body.operationUuid,{requestKey:f.options.requestKey,action:'supplier.refund.receive.62'},9))
})
test('permanent RF ACK and executed application remain unchanged after closing approved period',async()=>{
 const f=await fixture(),app=await approveOnly(f),first=await f.load('service').execute(app.id,operator);f.data.acct_periods.find(p=>p.period==='202610').status=2
 const again=await f.load('service').execute(app.id,operator);assert.equal(again.alreadyExecuted,true);assert.equal(funds(f).length,1);assert.equal(first.result.message,'回款已登记，凭证结果见详情')
})

// Actual HTTP adapters preserve action identity separately from application controls.
test('actual receive schema/controller submits application, not business, and original key cannot bypass it',async()=>{
 const f=await fixture(),rules=f.f.module('rules')
 const body=rules.receiveBody({...f.body,backfillRequest:true,backfillReason:reason})
 const req={body,params:{id:'61'},user:{userId:9},headers:{'x-request-key':f.options.requestKey}}
 let response,error
 const res={status(){return this},json(value){response=value;return value}}
 await f.load('controller').receive(req,res,e=>{error=e});assert.equal(error,undefined)
 assert.equal(response.data.backfillRequested,true);assert.equal(funds(f).length,0)
 const again=await f.f.module('service').receive(61,f.body,f.options)
 assert.equal(again.id,81);assert.equal(funds(f).length,0)
 await assert.rejects(f.f.module('service').receive(61,{...f.body,reason:'变更原请求'},f.options))
 const snapshot=JSON.parse(f.data.finance_period_backfills[0].request_snapshot)
 assert.ok(!Object.hasOwn(snapshot.body,'backfillRequest'));assert.equal(snapshot.identity.payloadHash.length,64)
 f.load('routes');const own=f.routes.find(r=>r.url==='/backfill-applications/:uuid')
 assert.equal(own.handlers.length,1,'authenticated own query adds no VIEW or write permission')
 const receive=f.routes.find(r=>r.url==='/:id/receive');assert.equal(receive.handlers[0].permission,P.SUPPLIER_REFUND_RECEIVE)
 let parsed;receive.handlers[1]({body:{...f.body,backfillRequest:true,backfillReason:reason}},null,e=>{parsed=e||true});assert.equal(parsed,true)
})
test('normal closed RF receive message offers cross-period application without changing true date',async()=>{
 const f=await fixture()
 await assert.rejects(f.f.module('service').receive(61,f.body,f.options),e=>e.code==='FINANCE_PERIOD_CLOSED'&&/跨期补录权限.*提交申请/.test(e.message)&&!/改为/.test(e.message))
 assert.equal(funds(f).length,0);assert.equal(f.data.finance_period_backfills.length,0)
})
test('actual approval persists first server date and original applicant then executes',async()=>{
 const f=await fixture(),app=await apply(f)
 const result=await f.load('service').approve(app.id,operator)
 assert.equal(result.result.status,3);assert.equal(result.application.approverId,10);assert.equal(result.application.applicantId,9)
 assert.equal(funds(f)[0].voucher_date_override,'2026-10-31')
})
test('application INSERT waits only after preparation company and user locks release',async()=>{
 const f=await fixture(),start=f.f.events.length;await apply(f)
 const events=f.f.events.slice(start)
 assert.equal(events.filter(e=>e==='begin').length,2);assert.equal(events.filter(e=>e==='commit').length,2)
 const inserts=f.queries.findIndex(q=>q.sql.startsWith('INSERT INTO finance_period_backfills'))
 const before=f.queries.slice(0,inserts),lastBegin=before.map(q=>q.sql).lastIndexOf('BEGIN')
 // Query lifecycle is captured independently by the connection events; second transaction contains no company/business locks.
 assert.ok(events.indexOf('release')<events.lastIndexOf('begin'))
 assert.ok(!f.queries.slice(lastBegin+1,inserts).some(q=>/FOR UPDATE/.test(q.sql)&&/purchase_|supplier_refund_orders/.test(q.sql)))
})
test('zero result reaches actual detail and list summary as checked notRequired',async()=>{
 const f=await fixture('0.0040'),app=await approveOnly(f);await f.load('service').execute(app.id,operator)
 const detail=await f.load('service').findOne(app.id),list=await f.load('service').findAll({bizType:'supplier_refund'})
 assert.equal(detail.voucherResult,'notRequired');assert.equal(detail.voucherNotRequired,true)
 assert.equal(list.summary.voucherPending,0);assert.equal(list.list[0].voucherResult,'notRequired');assert.equal(funds(f).length,1)
})
for(const amount of ['4.0000','0.0040'])test('application result-save failure stays pending after real money '+amount,async()=>{
 const f=await fixture(amount),app=await approveOnly(f);f.fail.match='SET voucher_generated_at'
 const result=await f.load('service').execute(app.id,operator)
 assert.equal(result.result.status,3);assert.equal(funds(f).length,1);assert.equal(result.application.voucherResult,'pending')
 assert.equal(result.result.message,'回款已登记，凭证结果见详情');assert.equal(f.data.finance_period_backfills[0].voucher_generated_at,null)
 const again=await f.load('service').execute(app.id,operator);assert.equal(again.alreadyExecuted,true);assert.equal(funds(f).length,1)
})
for(const mutate of [f=>f.data.finance_account_transactions.find(t=>t.biz_type===6).backfill_id=82,f=>f.data.finance_account_transactions.find(t=>t.biz_type===6).voucher_date_override='2026-11-01'])test('actual single-source proof rejects wrong application or approved date without cash retry',async()=>{
 const f=await fixture(),app=await approveOnly(f);await f.load('service').execute(app.id,operator);mutate(f)
 await assert.rejects(f.a.load('builder').loadSources(f.f.conn,{fundId:71,companyId:1}))
 const result=await f.load('service').regenerateVoucher(app.id,operator).catch(e=>e)
 assert.ok(result.code||result.voucherError);assert.equal(funds(f).length,1)
})
for(const bizType of [6,2])test('extra application-bound fund cannot be ignored in real result save '+bizType,async()=>{
 const f=await fixture('0.0040'),app=await approveOnly(f);await f.load('service').execute(app.id,operator)
 const original=funds(f)[0];f.data.finance_account_transactions.push({...copy(original),id:72,biz_type:bizType,biz_id:99,biz_no:'OTHER',backfill_id:81})
 await assert.rejects(f.load('service').regenerateVoucher(app.id,operator));assert.equal(funds(f).filter(t=>t.biz_id===61).length,1)
 assert.equal(f.data.finance_period_backfills[0].voucher_generated_at,null)
})
test('old payment execute retains execution-day posting instead of adopting approved day',async()=>{
 const f=await fixture(),app=await approveOnly(f),row=f.data.finance_period_backfills[0]
 row.biz_type='payment';row.request_snapshot=JSON.stringify({recordId:31,body:{amount:1},operator:{operatorId:9},requestKey:'old'})
 const result=await f.load('service').execute(app.id,operator)
 const today=require('../backend/src/utils/backendTime').beijingTodayYmd().replaceAll('-','').slice(0,6)
 assert.equal(result.postingPeriod,today);assert.equal(result.result.legacyPeriod,today);assert.equal(funds(f).length,0)
})

for(const amount of ['0.0040','0.0050'])test('actual exported application inspector proves correct zero/nonzero projection '+amount,async()=>{
 const f=await fixture(amount),app=await approveOnly(f);await f.load('service').execute(app.id,operator)
 const proof=await f.load('service').inspectBackfillVouchers(app.id,'202610')
 assert.equal(proof.ok,true);assert.equal(proof.txnCount,1);assert.equal(proof.voucherRequired,amount!=='0.0040')
})
test('actual inspector cannot claim zero success without original FAT or approved binding',async()=>{
 const f=await fixture('0.0040'),app=await approveOnly(f);await f.load('service').execute(app.id,operator)
 f.data.finance_account_transactions=f.data.finance_account_transactions.filter(t=>t.biz_type!==6)
 const proof=await f.load('service').inspectBackfillVouchers(app.id,'202610');assert.equal(proof.ok,false)
})
test('actual application controller reports checked zero without claiming voucher generation',async()=>{
 const f=await fixture('0.0040'),app=await approveOnly(f);await f.load('service').execute(app.id,operator)
 let response,error;const res={status(){return this},json(value){response=value;return value}}
 await f.load('applicationController').regenerateVoucher({params:{id:String(app.id)},user:{userId:10,realName:'approver'}},res,e=>{error=e})
 assert.equal(error,undefined);assert.equal(response.data.voucherResult,'notRequired');assert.match(response.message,/无需.*凭证/);assert.ok(!/已生成/.test(response.message))
})

test('actual controller same-key replay rejects changed application reason without changing RF action body',async()=>{
 const f=await fixture(),ctrl=f.load('controller'),req={params:{id:'61'},user:{userId:9},headers:{'x-request-key':f.options.requestKey},body:{...f.body,backfillRequest:true,backfillReason:reason}}
 const res={status(){return this},json(value){return value}};let error
 await ctrl.receive(req,res,e=>{error=e});assert.equal(error,undefined)
 await ctrl.receive({...req,body:{...req.body,backfillReason:'另一份不同的补录原因'}},res,e=>{error=e})
 assert.equal(error?.code,'SUPPLIER_REFUND_BACKFILL_IDENTITY_CHANGED');assert.equal(funds(f).length,0);assert.equal(f.data.finance_period_backfills.length,1)
 assert.equal(f.data.finance_period_backfills[0].reason,reason)
})
test('new approved RF checks current applicant write permissions before PO gate',async()=>{
 const f=await fixture(),app=await approveOnly(f);f.data.sys_role_permissions=f.data.sys_role_permissions.filter(p=>p.permission!==P.SUPPLIER_REFUND_RECEIVE)
 const start=f.queries.length;await assert.rejects(f.load('service').execute(app.id,operator))
 assert.ok(!f.queries.slice(start).some(q=>/FROM purchase_orders.*FOR SHARE/.test(q.sql)));assert.equal(funds(f).length,0)
})

test('approved full RF snapshot drift refuses before any fund INSERT even if application fingerprint is recomputed',async()=>{
 const f=await fixture(),app=await approveOnly(f),row=f.data.finance_period_backfills[0],data=JSON.parse(row.request_snapshot),rules=f.f.module('rules')
 data.frozen.amount='3.0000';row.amount='3.0000';row.request_snapshot=JSON.stringify(data)
 row.payload_fingerprint=rules.fingerprint(rules.stableJson({bizType:'supplier_refund',bizId:61,payload:data})).slice(0,16)
 const start=f.queries.length;await assert.rejects(f.load('service').execute(app.id,operator))
 assert.ok(!f.queries.slice(start).some(q=>q.sql.startsWith('INSERT INTO finance_account_transactions')))
 assert.equal(funds(f).length,0)
})

test('actual application failure result obeys 260 error width while fixed cash ACK remains unchanged',async()=>{
 const f=await fixture(),app=await approveOnly(f)
 f.fail.match='SELECT * FROM finance_account_transactions WHERE backfill_id';f.fail.errorMessage='fixture F4 write failure '+ '错'.repeat(600)
 const result=await f.load('service').execute(app.id,operator)
 assert.equal(result.result.status,3);assert.equal(funds(f).length,1);assert.equal([...result.voucherError].length,300)
 assert.equal([...result.application.voucherGenerateError].length,300);assert.equal(result.application.voucherPending,true)
 assert.equal(result.result.message,'回款已登记，凭证结果见详情')
})

// Every real accounting consumer must share the full application-linked fund collection.
for(const consumer of ['sourceProof','single','batch','close','executedReplay']){
  for(const bizType of [6,2])test('shared application fund uniqueness reaches actual '+consumer+' for extra biz '+bizType,async()=>{
    const f=await fixture('0.0040'),app=await approveOnly(f)
    const first=await f.load('service').execute(app.id,operator)
    const original=f.data.finance_account_transactions.find(t=>t.id===first.result.fundTransactionId)
    f.data.finance_account_transactions.push({...copy(original),id:72,biz_type:bizType,biz_id:99,biz_no:'OTHER',backfill_id:81})
    const before=copy(f.data),builder=f.a.load('builder'),engine=f.a.load('engine')
    if(consumer==='sourceProof'){
      await assert.rejects((async()=>{
        const sources=await builder.loadSources(f.f.conn,{companyId:1,fundId:original.id})
        await builder.proveSources(f.f.conn,sources,engine,1)
      })(),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
    }else if(consumer==='single'){
      const result=await f.a.load('accounting').settleReceivedVoucher(first.result)
      assert.equal(result.status,'pending','bad application funds cannot be checked zero-cent success')
    }else if(consumer==='batch'){
      await f.f.conn.beginTransaction()
      try{
        await assert.rejects(engine.generateVouchers(f.f.conn,{companyId:1,period:'202610'}),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
      }finally{await f.f.conn.rollback()}
    }else if(consumer==='close'){
      await assert.rejects(f.a.load('period').closePeriod('202610',{userId:9},1),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
    }else{
      await assert.rejects(f.load('service').execute(app.id,operator),e=>e.code==='SUPPLIER_REFUND_BACKFILL_IDENTITY_CHANGED')
    }
    assert.deepEqual(f.data.finance_account_transactions,before.finance_account_transactions,'never receive again or rewrite funds')
    assert.deepEqual(f.data.payment_records,before.payment_records,'no AP rewrite')
    assert.deepEqual(f.data.acct_vouchers,before.acct_vouchers,'no voucher generated from invalid source')
    assert.deepEqual(f.data.acct_periods,before.acct_periods,'no closing on invalid source')
    if(consumer==='executedReplay')assert.deepEqual(f.data,before,'replay refusal rolls back without metadata writes')
  })
}
for(const [field,value] of [['direction',2],['account_id',41],['amount','0.0039'],['biz_no','OTHER']]){
  test('executed application replay proves original fund '+field+' before returning original ACK',async()=>{
    const f=await fixture('0.0040'),app=await approveOnly(f)
    const first=await f.load('service').execute(app.id,operator)
    f.data.finance_account_transactions.find(t=>t.id===first.result.fundTransactionId)[field]=value
    const before=copy(f.data)
    await assert.rejects(f.load('service').execute(app.id,operator),e=>['SUPPLIER_REFUND_OPERATION_CONFLICT','SUPPLIER_REFUND_BACKFILL_IDENTITY_CHANGED'].includes(e.code))
    assert.deepEqual(f.data,before,'invalid original fund cannot trigger receive or result writes')
  })
}
test('valid application source reads all application funds in one exact batch and retains original ACK',async()=>{
  const f=await fixture('0.0040'),app=await approveOnly(f)
  const first=await f.load('service').execute(app.id,operator),start=f.a.queries.length
  const sources=await f.a.load('builder').loadSources(f.f.conn,{companyId:1,fundId:first.result.fundTransactionId})
  assert.equal(sources.length,1)
  const reads=f.a.queries.slice(start).filter(q=>q.sql==='SELECT * FROM finance_account_transactions WHERE backfill_id IN (?) ORDER BY id')
  assert.equal(reads.length,1);assert.deepEqual(reads[0].args,[[81]])
  const replay=await f.load('service').execute(app.id,operator)
  assert.equal(replay.alreadyExecuted,true);assert.equal(funds(f).length,1)
})

// Full-kind lookup and result persistence occur after the permanent cash ACK committed.
const fullKindSql="SELECT *,DATE_FORMAT(approved_at,'%Y-%m-%d') AS approved_date FROM finance_period_backfills WHERE id = ? AND company_id = ?"
const pendingSaveSql='UPDATE finance_period_backfills SET voucher_generated_at=NULL,voucher_generate_error=? WHERE id = ?'
for(const saveFails of [false,true])test('postcommit kind lookup failure retains cash success and permanent ACK; saveFails='+saveFails,async()=>{
 const f=await fixture(),app=await approveOnly(f),start=f.queries.length
 f.fail.exact=[{sql:fullKindSql,id:81},...(saveFails?[{sql:pendingSaveSql,id:81}]:[])]
 f.fail.errorMessage='fixture F4 write failure '+ '错'.repeat(600)
 const result=await f.load('service').execute(app.id,operator)
 assert.equal(result.executed,true);assert.equal(result.result.status,3);assert.equal(result.result.message,'回款已登记，凭证结果见详情')
 assert.equal(result.voucherResult,'pending');assert.equal(result.application.voucherPending,true);assert.equal([...result.voucherError].length,300)
 assert.equal(funds(f).length,1);assert.equal(funds(f)[0].happened_at,'2026-09-01');assert.equal(funds(f)[0].voucher_date_override,'2026-10-31');assert.equal(funds(f)[0].backfill_id,app.id)
 assert.equal(f.data.payment_records[0].paid_amount,'96.0000');assert.equal(f.data.finance_period_backfills[0].executed_at,'2026-11-01');assert.equal(f.data.finance_period_backfills[0].voucher_generated_at,null)
 assert.equal(f.data.acct_vouchers.length,0,'failed kind read must not guess an old generator')
 const reads=f.queries.slice(start),lookup=reads.findIndex(q=>q.sql===fullKindSql)
 assert.ok(reads.slice(0,lookup).some(q=>q.sql==='COMMIT'),'cash committed before failed lookup')
 assert.equal(reads.filter(q=>q.sql.startsWith('INSERT INTO finance_account_transactions')).length,1)
 const before=copy(f.data),ack=JSON.parse(f.data.supplier_refund_operations.find(op=>op.operation_uuid===f.body.operationUuid).response_json)
 assert.deepEqual(ack,copy(result.result),'returned result is the permanent original ACK')
 f.fail.exact=[]
 const again=await f.load('service').execute(app.id,operator)
 assert.equal(again.alreadyExecuted,true);assert.deepEqual(f.data,before,'executed replay performs no cash/AP/ACK or metadata writes')
})
for(const saveFails of [false,true])test('automatic retry isolates RF kind lookup failure and continues old no-fund settlement; saveFails='+saveFails,async()=>{
 const f=await fixture(),app=await approveOnly(f)
 f.a.fail.match='INSERT INTO acct_vouchers';await f.load('service').execute(app.id,operator);f.a.fail.match=null
 f.data.finance_period_backfills.push({...copy(f.data.finance_period_backfills[0]),id:82,biz_type:'receipt_settle',biz_id:22,executed_biz_id:22,request_key:'old-settlement-key',request_snapshot:JSON.stringify({receiptId:22,body:{}}),voucher_generated_at:null,voucher_generate_error:null})
 const before=copy(f.data),start=f.queries.length
 f.fail.exact=[{sql:fullKindSql,id:81},...(saveFails?[{sql:pendingSaveSql,id:81}]:[])]
 const result=await f.load('service').retryPendingVoucherGeneration()
 assert.deepEqual(copy(result),{scanned:2,succeeded:1,failed:1})
 assert.equal(f.data.finance_period_backfills[0].voucher_generated_at,null);assert.ok(f.data.finance_period_backfills[1].voucher_generated_at)
 assert.equal(f.data.finance_period_backfills[1].voucher_generate_error,null)
 for(const field of ['finance_account_transactions','payment_records','supplier_refund_operations','supplier_refund_orders'])assert.deepEqual(f.data[field],before[field],field+' not replayed by voucher retry')
 assert.ok(!f.queries.slice(start).some(q=>q.sql.startsWith('INSERT INTO finance_account_transactions')))
 assert.equal(f.data.acct_vouchers.length,0,'old receipt_settle remains no-fund/no-generation')
})

test('automatic retry counts missing-period save failure and continues next old settlement',async()=>{
 const f=await fixture(),app=await approveOnly(f)
 f.a.fail.match='INSERT INTO acct_vouchers';await f.load('service').execute(app.id,operator)
 f.data.finance_period_backfills.push({...copy(f.data.finance_period_backfills[0]),id:82,biz_type:'receipt_settle',voucher_generated_at:null,voucher_generate_error:null})
 f.data.finance_period_backfills[0].posting_period=null
 f.fail.exact=[{sql:'UPDATE finance_period_backfills SET voucher_generate_error = ? WHERE id = ?',id:81}]
 const before=copy(f.data),result=await f.load('service').retryPendingVoucherGeneration()
 assert.deepEqual(copy(result),{scanned:2,succeeded:1,failed:1})
 assert.deepEqual(f.data.finance_period_backfills[0],before.finance_period_backfills[0],'failed status save does not fabricate a result')
 assert.ok(f.data.finance_period_backfills[1].voucher_generated_at)
 for(const field of ['finance_account_transactions','payment_records','supplier_refund_operations','supplier_refund_orders'])assert.deepEqual(f.data[field],before[field])
})

// Only the postcommit application-detail query/JSON formatter fails; permanent cash and proof remain actual.
for(const action of ['execute','approve','replay','regenerate'])for(const fault of ['query','fmt'])test('actual '+action+' postcommit application '+fault+' cannot turn committed cash/proof into business failure',async()=>{
 const f=await fixture('4.0000');const app=action==='approve'?await apply(f):await approveOnly(f);
 if(action==='replay'||action==='regenerate')await f.load('service').execute(app.id,operator);
 const beforeFunds=copy(funds(f)),start=f.queries.length;f.fail.applicationDetail=fault;
 let response,error;const res={status(){return this},json(value){response=value;return value}};
 const method=action==='replay'?'execute':action==='regenerate'?'regenerateVoucher':action;
 await f.load('applicationController')[method]({params:{id:String(app.id)},user:{userId:10,realName:'approver'},body:{}},res,e=>{error=e});
 assert.equal(error,undefined,'postcommit details must return successful business result');assert.equal(response.success,true);
 const result=response.data;assert.equal(result.id,81);assert.equal(result.applicationNo,'BF-20261030-0081');assert.equal(result.bizType,'supplier_refund');assert.equal(result.bizTypeName,'供应商退款');
 assert.equal(result.application,null);assert.equal(result.applicationPending,true);assert.ok(result.applicationError);assert.equal(result.voucherError,null);assert.equal(result.voucherResult,'generated');assert.equal(result.postingPeriod,'202610');
 if(action!=='regenerate'){const ack=JSON.parse(f.data.supplier_refund_operations.find(op=>op.operation_uuid===f.body.operationUuid).response_json);assert.deepEqual(copy(result.result),ack);assert.equal(result.result.status,3)}
 if(action==='replay')assert.equal(result.alreadyExecuted,true);
 assert.equal(funds(f).length,1);assert.equal(funds(f)[0].happened_at,'2026-09-01');assert.equal(funds(f)[0].voucher_date_override,'2026-10-31');assert.equal(f.data.acct_vouchers.length,1);
 if(beforeFunds.length)assert.deepEqual(funds(f),beforeFunds,'no duplicate receive on replay or regenerate');
 assert.match(response.message,/详情待加载/);assert.ok(!/业务没能|凭证未生成成功/.test(response.message));
 const queries=f.queries.slice(start),lastCommit=queries.map(q=>q.sql).lastIndexOf('COMMIT');assert.ok(lastCommit>=0||action==='regenerate');assert.ok(!queries.slice(lastCommit+1).some(q=>q.sql==='ROLLBACK'),'never rollback because application read failed after commit');
})
test('actual precommit execution-mark failure still rejects and rolls back cash/AP/ACK',async()=>{
 const f=await fixture(),app=await approveOnly(f),before=copy(f.data);f.fail.match='SET executed_at = NOW()';
 await assert.rejects(f.load('service').execute(app.id,operator));assert.deepEqual(f.data,before);assert.ok(f.queries.some(q=>q.sql==='ROLLBACK'));
})
for(const fault of ['before','after'])test('actual commit '+fault+' uncertainty remains rejection and cannot claim application pending success',async()=>{
 const f=await fixture(),app=await approveOnly(f);f.fail.commit=fault;let response,error;const res={status(){return this},json(value){response=value;return value}};
 await f.load('applicationController').execute({params:{id:String(app.id)},user:{userId:10,realName:'approver'}},res,e=>{error=e});assert.match(error?.message||'',/commit uncertain/);assert.equal(response,undefined);
 assert.equal(f.data.acct_vouchers.length,0);if(fault==='before')assert.equal(funds(f).length,0);else assert.equal(funds(f).length,1,'committed model cash is still not enough to guess a successful response');
})

test('generic backfill delayed retry keeps original approval month, not today', async () => {
 const f=await fixture('4.0000',{oldPayment:true}),app=await approveOnly(f),row=f.data.finance_period_backfills[0];
 row.biz_type='payment';row.request_key='old-fixed';row.approved_at='2026-09-30 23:59:59';row.request_snapshot=JSON.stringify({recordId:31,body:{amount:1}});
 f.data.acct_periods.find(p=>p.period==='202609').status=0;
 const result=await f.load('service').execute(app.id,operator);
 assert.equal(result.postingPeriod,'202609');assert.equal(result.result.legacyPeriod,'202609');
})
test('generic backfill delayed retry refuses closed original approval month before business replay', async () => {
 const f=await fixture('4.0000',{oldPayment:true}),app=await approveOnly(f),row=f.data.finance_period_backfills[0];
 row.biz_type='payment';row.request_key='old-fixed';row.approved_at='2026-09-30 23:59:59';row.request_snapshot=JSON.stringify({recordId:31,body:{amount:1}});
 const before=copy(f.data);await assert.rejects(f.load('service').execute(app.id,operator),e=>e.code==='FINANCE_BACKFILL_POSTING_PERIOD_CLOSED');assert.deepEqual(f.data,before);
})
test('generic guarded backfill pins voucher day to saved approval day even if business period reopened', async () => {
 const f=await fixture(),guard=f.load('guard');f.data.acct_periods.find(p=>p.period==='202609').status=0;await f.f.conn.beginTransaction();
 try {
  const proof=await guard.assertFinancePeriodOpen(f.f.conn,'2026-10-01',{backfill:{mode:'execute',approvedId:81,postingPeriod:'202609',postingDate:'2026-09-30'}});
  assert.equal(proof.voucherDateOverride,'2026-09-30');assert.ok(f.events.includes('period:202609:X'));
 }finally{await f.f.conn.rollback()}
})

for(const kind of ['payment','receipt_settle'])for(const fault of ['query','fmt'])test('legacy '+kind+' execution preserves original period/proof despite application '+fault+' failure',async()=>{
 const f=await fixture('4.0000',{oldPayment:kind==='payment',oldSettlement:kind==='receipt_settle'}),app=await approveOnly(f),row=f.data.finance_period_backfills[0];
 row.biz_type=kind;row.request_key='old-fixed';row.request_snapshot=JSON.stringify(kind==='payment'?{recordId:31,body:{amount:1},operator:{operatorId:9}}:{receiptId:22,body:{},operator:{operatorId:9}});f.fail.applicationDetail=fault;
 const result=await f.load('service').execute(app.id,operator),approvedPeriod=f.approvedDate.replaceAll('-','').slice(0,6);
 assert.equal(result.executed,true);assert.equal(result.bizType,kind);assert.equal(result.id,81);assert.equal(result.applicationNo,'BF-20261030-0081');assert.equal(result.application,null);assert.equal(result.applicationPending,true);assert.ok(result.applicationError);assert.equal(result.postingPeriod,approvedPeriod);assert.equal(result.result.legacyPeriod,approvedPeriod);assert.equal(funds(f).length,0);
 if(kind==='receipt_settle'){assert.equal(result.voucherRequired,false);assert.equal(result.voucherError,null);assert.equal(f.data.finance_period_backfills[0].voucher_generate_error,null)}else{assert.match(result.voucherError,/old payment generator/);assert.ok(!result.voucherResult,'old payment proof must not impersonate new refund result')}
})
for(const fault of ['query','fmt'])test('legacy receipt_settle regeneration keeps no-voucher proof with application '+fault+' failure',async()=>{
 const f=await fixture('4.0000',{oldSettlement:true}),app=await approveOnly(f),row=f.data.finance_period_backfills[0];row.biz_type='receipt_settle';row.request_key='old-fixed';row.request_snapshot=JSON.stringify({receiptId:22,body:{},operator:{operatorId:9}});
 await f.load('service').execute(app.id,operator);f.fail.applicationDetail=fault;
 let response,error;const res={status(){return this},json(value){response=value;return value}};await f.load('applicationController').regenerateVoucher({params:{id:String(app.id)},user:{userId:10,realName:'approver'}},res,e=>{error=e});
 assert.equal(error,undefined);assert.equal(response.data.bizType,'receipt_settle');assert.equal(response.data.application,null);assert.equal(response.data.applicationPending,true);assert.equal(response.data.voucherRequired,false);assert.equal(response.data.voucherError,null);assert.match(response.message,/无需.*凭证.*详情待加载/);assert.ok(!/已生成/.test(response.message));assert.equal(funds(f).length,0);
})
