'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {fixture,required,copy,assertNoModelErrors}=require('./helpers/supplier-refunds-accounting-fixture')
test.afterEach(assertNoModelErrors)
async function build(f,options={}){return required(f.load('builder'),'loadSources')(f.f.conn,{companyId:1,fundId:f.ack.fundTransactionId,...options})}
for(const [amount,projected] of [['0.0001','0.00'],['0.0040','0.00'],['0.0049','0.00'],['0.0050','0.01'],['0.0051','0.01'],['4.0000','4.00']]){
  test('actual received source validates before exact cent projection '+amount,async()=>{
    const f=await fixture(amount),sources=await build(f)
    assert.equal(sources.length,1);assert.equal(sources[0].amount4,amount);assert.equal(sources[0].amount2,projected)
    assert.equal(sources[0].spec.sourceType,'supplier_refund_in');assert.equal(sources[0].spec.sourceId,f.ack.fundTransactionId)
    assert.equal(sources[0].notRequired,projected==='0.00')
    if(projected!=='0.00')assert.deepEqual(copy(sources[0].spec.legs.map(l=>[l.code,l.direction,l.amount,l.auxId??null])),[['1002',1,projected,null],['2202',2,projected,4]])
  })
}
for(const mutate of ['missingRF','badRF','missingFund','badFundAmount','badDirection','badDate','badCompany','missingFundName','missingAlloc','badAlloc','missingReceivedOperation','badOriginalOUT','badOriginalPrice','missingAccountType']){
  test('actual batch received proof fails loudly '+mutate,async()=>{
    const f=await fixture('0.0040')
    const r=f.data.supplier_refund_orders[0],fund=f.data.finance_account_transactions.find(t=>t.id===f.ack.fundTransactionId)
    if(mutate==='missingRF')f.data.supplier_refund_orders=[]
    if(mutate==='badRF')r.status=2
    if(mutate==='missingFund')f.data.finance_account_transactions=f.data.finance_account_transactions.filter(t=>t.id!==fund.id)
    if(mutate==='badFundAmount')fund.amount='0.0041'
    if(mutate==='badDirection')fund.direction=2
    if(mutate==='badDate')fund.happened_at='2026-10-02'
    if(mutate==='badCompany')r.company_id=2
    if(mutate==='missingFundName')fund.party_name=null
    if(mutate==='missingAlloc')f.data.supplier_refund_allocations=[]
    if(mutate==='badAlloc')f.data.supplier_refund_allocations[0].budget_state='reserved'
    if(mutate==='missingReceivedOperation')f.data.supplier_refund_operations=f.data.supplier_refund_operations.filter(o=>!o.action.includes('.receive.'))
    if(mutate==='badOriginalOUT')f.data.finance_account_transactions[0].biz_no='other'
    if(mutate==='badOriginalPrice')f.data.purchase_order_items[0].unit_price='99.0000'
    if(mutate==='missingAccountType')r.received_account_type=null
    await assert.rejects(build(f),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
  })
}
test('legitimate PR3 AP reduction and confirmation reset preserve received source',async()=>{
  const f=await fixture('30.0000','30.0000');f.data.purchase_returns[0].status=3
  Object.assign(f.data.payment_records[0],{total_amount:'70.0000',paid_amount:'70.0000',balance:'0.0000',confirm_status:0})
  assert.equal((await build(f))[0].amount4,'30.0000')
})
test('legitimate unshipped PR cancellation keeps received projection and fixed account mapping',async()=>{
  const f=await fixture();f.data.purchase_returns[0].status=4
  f.data.finance_accounts.find(a=>a.id===42).type=2
  const source=(await build(f))[0];assert.equal(source.spec.legs[0].code,'1002')
})
test('voucher override without original approved supplier refund application is rejected',async()=>{
  const f=await fixture();const fund=f.data.finance_account_transactions.find(t=>t.id===f.ack.fundTransactionId)
  fund.voucher_date_override='2026-11-02';await assert.rejects(build(f),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
})
test('postcommit actual single generate, prove and save keeps original receive ACK',async()=>{
  const f=await fixture();const before=copy(f.ack)
  const result=await required(f.load('accounting'),'settleReceivedVoucher')(f.ack)
  assert.equal(result.status,'generated');assert.equal(f.data.acct_vouchers.length,1);assert.equal(f.data.acct_voucher_entries.length,2)
  assert.equal(f.data.supplier_refund_orders[0].voucher_id,result.voucherId);assert.equal(f.data.supplier_refund_orders[0].voucher_generate_error,null)
  assert.deepEqual(copy(f.ack),before)
})
test('zero-cent complete source proves notRequired without claiming generated voucher',async()=>{
  const f=await fixture('0.0040')
  const result=await required(f.load('accounting'),'settleReceivedVoucher')(f.ack)
  assert.equal(result.status,'notRequired');assert.equal(f.data.acct_vouchers.length,0)
  assert.match(f.data.supplier_refund_orders[0].voucher_generate_error,/零分投影已核对/)
})
test('close-period dedicated gate rejects missing nonzero source voucher',async()=>{
  const f=await fixture()
  await assert.rejects(required(f.load('builder'),'assertPeriodCurrent')(f.f.conn,'202610',1),e=>e.code==='ACCT_SUPPLIER_REFUND_VOUCHER_REQUIRED')
})
test('later legitimate other received RF consumes cumulative principal without invalidating first hash',async()=>{
  const f=await fixture('30.0000'),first=(await build(f))[0]
  const service=f.f.module('service'),raw={...f.body,operationUuid:require('./helpers/supplier-refunds-accounting-fixture').uuid(311),amount:'20.0000',allocations:[{entryId:21,amount:'20.0000'}]}
  const second=await service.create(raw,f.f.options)
  await service.confirm(second.id,{operationUuid:require('./helpers/supplier-refunds-accounting-fixture').uuid(312)},f.f.options)
  await service.receive(second.id,{operationUuid:require('./helpers/supplier-refunds-accounting-fixture').uuid(313)},{...f.f.options,postCommit:async()=>{}})
  assert.deepEqual(copy((await build(f))[0].spec),copy(first.spec))
  assert.equal(f.data.payment_records[0].paid_amount,'50.0000')
})
for(const failure of ['INSERT INTO acct_vouchers','INSERT INTO acct_voucher_entries','UPDATE supplier_refund_orders SET voucher_']){
  test('postcommit '+failure+' failure remains pending with cash/AP unchanged',async()=>{
    const f=await fixture(),funds=copy(f.data.finance_account_transactions),ap=copy(f.data.payment_records)
    f.fail.match=failure
    const result=await required(f.load('accounting'),'settleReceivedVoucher')(f.ack)
    assert.equal(result.status,'pending');assert.deepEqual(f.data.finance_account_transactions,funds);assert.deepEqual(f.data.payment_records,ap)
    assert.equal(f.data.acct_vouchers.length,0);assert.equal(f.data.acct_voucher_entries.length,0)
    assert.equal(f.data.supplier_refund_orders[0].voucher_id??null,null)
  })
}
test('manual reversal stays pending and actual upsert cannot resurrect original refund voucher',async()=>{
  const f=await fixture();const accounting=f.load('accounting')
  assert.equal((await required(accounting,'settleReceivedVoucher')(f.ack)).status,'generated')
  f.data.acct_vouchers[0].status=3
  const before=copy(f.data.acct_vouchers),result=await accounting.settleReceivedVoucher(f.ack)
  assert.equal(result.status,'pending');assert.deepEqual(f.data.acct_vouchers,before)
})
test('bad source with zero projected cents cannot pass close-period proof as notRequired',async()=>{
  const f=await fixture('0.0040');f.data.supplier_refund_allocations=[]
  await assert.rejects(required(f.load('builder'),'assertPeriodCurrent')(f.f.conn,'202610',1),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
})

test('actual default afterReceiveCommit closes the actual single accounting boundary after money commit',async()=>{
  const f=await fixture(),before=copy(f.data.finance_account_transactions)
  const result=await f.load('postcommit').afterReceiveCommit(f.ack)
  assert.equal(result.status,'generated');assert.equal(f.data.acct_vouchers.length,1)
  assert.deepEqual(f.data.finance_account_transactions,before)
  assert.ok(f.f.events.indexOf('cash:commit')<f.f.events.lastIndexOf('begin'))
})
test('actual original batch generate uses the same single RF source and leaves old source ranges intact',async()=>{
  const f=await fixture('0.0050'),expected=(await build(f))[0]
  await f.f.conn.beginTransaction()
  const result=await f.load('engine').generateVouchers(f.f.conn,{companyId:1,period:'202610'})
  await f.f.conn.commit()
  assert.equal(result.created,1);assert.equal(f.data.acct_vouchers.length,1)
  assert.equal(f.data.acct_vouchers[0].source_hash,f.load('engine').hashSpec(expected.spec.voucherDate,expected.spec.legs))
  assert.equal((await f.load('builder').proveSources(f.f.conn,[expected],f.load('engine'),1))[0].status,'generated')
})
test('actual closePeriod company-gate ordering reads a bad-source mutation before any period snapshot',async()=>{
  const f=await fixture('0.0040')
  f.fail.companyGate=state=>{state.finance_account_transactions.find(t=>t.id===f.ack.fundTransactionId).amount='0.0041'}
  const from=f.queries.length
  await assert.rejects(f.load('period').closePeriod('202610',{userId:9},1),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
  const queries=f.queries.slice(from)
  assert.match(queries[0].sql,/acct_companies.*FOR UPDATE/)
  assert.match(queries[1].sql,/supplier-refund-facts/)
  assert.equal(queries.some(q=>q.sql.startsWith('INSERT INTO acct_periods')),false)
  assert.equal(f.data.acct_periods.length,0)
})
test('actual closePeriod accepts complete zero-cent source without a fake voucher',async()=>{
  const f=await fixture('0.0040')
  assert.equal((await f.load('period').closePeriod('202610',{userId:9},1)).status,2)
  assert.equal(f.data.acct_periods[0].status,2);assert.equal(f.data.acct_vouchers.length,0)
})
test('new company filter leaves company2 empty without copying company1 RF source',async()=>{
  const f=await fixture()
  assert.deepEqual(copy(await f.load('builder').loadSources(f.f.conn,{companyId:2})),[])
})
test('PR unknown status cannot pass received historical proof',async()=>{
  const f=await fixture();f.data.purchase_returns[0].status=99
  await assert.rejects(build(f),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
})
test('receipt post-settlement balance and current statement membership are mutable history, not RF source identity',async()=>{
  const f=await fixture('4.0000','100.0000',{receipt:true})
  assert.equal((await build(f))[0].amount4,'4.0000')
  f.data.payment_records.push({id:32,type:1,order_id:13,order_no:'PO13',total_amount:'20.0000',paid_amount:'20.0000',balance:'0.0000'})
  f.data.payment_entries.push({id:22,record_id:32,amount:'20.0000',account_id:null,receipt_id:21,statement_id:null,payment_date:'2026-10-02'})
  f.data.payment_receipts[0].settled_amount='100.0000';f.data.payment_receipts[0].balance='0.0000'
  f.data.reconciliation_statement_items.push({id:1,statement_id:81,record_id:31})
  assert.equal((await build(f))[0].amount4,'4.0000')
})
for(const defect of ['hash','legs','period','sourceNo'])test('actual voucher proof rejects drift '+defect,async()=>{
  const f=await fixture();assert.equal((await f.load('accounting').settleReceivedVoucher(f.ack)).status,'generated')
  if(defect==='hash')f.data.acct_vouchers[0].source_hash='bad'
  if(defect==='legs')f.data.acct_voucher_entries[1].aux_id=999
  if(defect==='period')f.data.acct_vouchers[0].period='202611'
  if(defect==='sourceNo')f.data.acct_vouchers[0].source_no='bad'
  await assert.rejects(f.load('builder').assertPeriodCurrent(f.f.conn,'202610',1),e=>e.code==='ACCT_SUPPLIER_REFUND_VOUCHER_REQUIRED')
})
test('manual regeneration checks live permissions inside the company transaction',async()=>{
  const f=await fixture();f.fail.companyGate=state=>{state.sys_role_permissions=[]}
  await assert.rejects(f.load('accounting').regenerate(61,9),e=>e.code==='SUPPLIER_REFUND_AUTH_DENIED')
  assert.equal(f.data.acct_vouchers.length,0);assert.equal(f.data.supplier_refund_orders[0].voucher_generate_error,'凭证待生成')
})
test('actual reconciliation separately consumes cash4u, per-source cents and net paid while old gross stays unchanged',async()=>{
  const f=await fixture('0.0040')
  const result=await f.load('vouchers').reconciliation(1)
  assert.equal(result.items[1].business,100);assert.equal(result.items[1].voucher,100)
  assert.deepEqual(copy(result.supplierRefunds),{cashAmount4:'0.0040',projectedAmount2:'0.00',roundingDifference4:'-0.0040',netPaid4:'99.9960',currentPaid4:'99.9960',paidDifference4:'0.0000',balanceDifference4:'0.0000',mismatchedPaymentCount:0,matched:true})
})
test('multiple tiny real receipts retain four-place cash and do not invent a shared cent',async()=>{
  const f=await fixture('0.0040'),service=f.f.module('service')
  const initial=f.queries.length;await f.load('builder').loadSources(f.f.conn,{companyId:1});const oneReads=f.queries.length-initial
  const raw={...f.body,operationUuid:require('./helpers/supplier-refunds-accounting-fixture').uuid(321)}
  const second=await service.create(raw,f.f.options)
  await service.confirm(second.id,{operationUuid:require('./helpers/supplier-refunds-accounting-fixture').uuid(322)},f.f.options)
  await service.receive(second.id,{operationUuid:require('./helpers/supplier-refunds-accounting-fixture').uuid(323)},{...f.f.options,postCommit:async()=>{}})
  const from=f.queries.length,sources=await f.load('builder').loadSources(f.f.conn,{companyId:1}),reads=f.queries.length-from
  assert.equal(sources.length,2);assert.equal(reads,oneReads)
  const metric=await f.load('builder').reconciliation(f.f.conn,1)
  assert.equal(metric.cashAmount4,'0.0080');assert.equal(metric.projectedAmount2,'0.00');assert.equal(metric.roundingDifference4,'-0.0080')
})

test('captured cash account type remains 1001 after current account type changes',async()=>{
  const f=await fixture('4.0000','100.0000',{accountType:2}),first=(await build(f))[0]
  assert.equal(first.spec.legs[0].code,'1001')
  f.data.finance_accounts.find(a=>a.id===42).type=1
  assert.deepEqual(copy((await build(f))[0].spec),copy(first.spec))
})
test('manual error metadata save rechecks permissions after rollback and company lock reacquisition',async()=>{
  const f=await fixture();let gates=0
  f.fail.match='INSERT INTO acct_vouchers'
  f.fail.companyGate=state=>{if(++gates===3)state.sys_role_permissions=[]}
  assert.equal((await f.load('accounting').regenerate(61,9)).status,'pending')
  assert.equal(f.data.supplier_refund_orders[0].voucher_generate_error,'凭证待生成')
  assert.equal(f.data.acct_vouchers.length,0)
})
for(const defect of ['actor','key','resource'])test('permanent received proof rejects immutable operation drift '+defect,async()=>{
  const f=await fixture(),operation=f.data.supplier_refund_operations.find(o=>o.action.includes('.receive.'))
  if(defect==='actor')operation.actor_id=8
  if(defect==='key')operation.request_key=''
  if(defect==='resource')operation.resource_id=99
  await assert.rejects(build(f),e=>e.code==='ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
})
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function entry(file,deps){const filename=path.resolve(__dirname,'../backend/src',file),module={exports:{}}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:dep=>{if(Object.hasOwn(deps,dep))return deps[dep];throw Error('Unstubbed F3 entry '+dep)}},{filename});return module.exports}
test('registered regenerate endpoint requires original voucher manage, not receive; controller forwards authoritative userId',async()=>{
  const rows=[],router={use(){},get:(url,...middleware)=>rows.push({method:'get',url,middleware}),post:(url,...middleware)=>rows.push({method:'post',url,middleware})}
  const {PERMISSIONS}=require('../backend/src/constants/permissions'),f=await fixture()
  const calls=[],controller=entry('modules/refunds/supplier-refunds.controller.js',{
    './supplier-refunds.service':{regenerateVoucher:async(...args)=>{calls.push(args);return{status:'pending'}}},
    '../../utils/response':require('../backend/src/utils/response'),'../../utils/requestKey':require('../backend/src/utils/requestKey'),
  })
  entry('modules/refunds/supplier-refunds.routes.js',{
    express:{Router:()=>router},'./supplier-refunds.controller':controller,'./supplier-refunds.rules':f.f.module('rules'),
    '../../middleware/auth':{authMiddleware(){},requirePermission:permission=>({permission})},
    '../../constants/permissions':{PERMISSIONS},'../../utils/route':require('../backend/src/utils/route'),
  })
  const route=rows.find(r=>r.url==='/:id/regenerate-voucher');assert.ok(route)
  assert.equal(route.middleware[0].permission,PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE)
  const res={status:()=>res,json:()=>{}}
  await controller.regenerateVoucher({params:{id:'61'},user:{userId:9,id:88}},res,error=>{throw error})
  assert.deepEqual(copy(calls),[['61',9]])
})

test('common actual report projection must not call opposite per-AP discrepancies matched',async()=>{
  const f=await fixture(),source=(await build(f))[0]
  const other={...copy(source),paymentRecordId:32,currentPaid4:'95.9999',balance4:'4.0001'}
  source.currentPaid4='96.0001';source.balance4='3.9999'
  const summary=f.load('builder').summarizeSources([source,other])
  assert.equal(summary.paidDifference4,'0.0000');assert.equal(summary.matched,false)
})

test('already proved refund voucher survives later closed period without rewriting cash or voucher',async()=>{
  const f=await fixture();await f.load('accounting').settleReceivedVoucher(f.ack)
  f.data.acct_periods.push({company_id:1,period:'202610',status:2})
  const vouchers=copy(f.data.acct_vouchers),funds=copy(f.data.finance_account_transactions)
  const result=await f.load('postcommit').afterReceiveCommit(f.ack)
  assert.equal(result.status,'generated')
  assert.deepEqual(f.data.acct_vouchers,vouchers);assert.deepEqual(f.data.finance_account_transactions,funds)
  assert.equal(f.data.supplier_refund_orders[0].voucher_generate_error,null)
})


test('actual received optional reason remains in the canonical permanent action proof',async()=>{
  const f=await fixture('4.0000','100.0000',{receiveReason:'供应商到账后核实收到'})
  const operation=f.data.supplier_refund_operations.find(o=>o.action===`supplier.refund.receive.${f.ack.id}`)
  assert.equal(JSON.parse(operation.payload_json).reason,'供应商到账后核实收到')
  assert.equal((await build(f))[0].amount4,'4.0000')
})
test('actual company1 SQL boundary excludes another company complete RF account and fund parents',async()=>{
  const f=await fixture(),head=f.data.supplier_refund_orders[0]
  const fund=f.data.finance_account_transactions.find(t=>t.id===f.ack.fundTransactionId)
  const account=f.data.finance_accounts.find(a=>a.id===head.income_account_id)
  f.data.finance_accounts.push({...copy(account),id:142,company_id:2})
  f.data.supplier_refund_orders.push({...copy(head),id:99,company_id:2,payment_record_id:132,income_account_id:142,fund_transaction_id:171,refund_no:'RFOTHERCOMPANY'})
  f.data.finance_account_transactions.push({...copy(fund),id:171,account_id:142,biz_id:99,biz_no:'RFOTHERCOMPANY'})
  const sources=await f.load('builder').loadSources(f.f.conn,{companyId:1})
  assert.deepEqual(sources.map(source=>source.refundId),[f.ack.id])
  assert.equal(f.queries.find(q=>q.sql.includes('supplier-refund-facts')).args[0],1)
})


for(const leg of ['supplier','fund'])for(const consumer of ['proof','postcommit','closePeriod']){
  test(`actual ${consumer} rejects ${leg} auxiliary type drift without changing original hash or cash`,async()=>{
    const f=await fixture()
    assert.equal((await f.load('accounting').settleReceivedVoucher(f.ack)).status,'generated')
    const vouchers=copy(f.data.acct_vouchers),funds=copy(f.data.finance_account_transactions),ap=copy(f.data.payment_records)
    const row=f.data.acct_voucher_entries.find(e=>e.account_code===(leg==='supplier'?'2202':'1002'))
    assert.equal(row.aux_type,leg==='supplier'?1:0)
    row.aux_type=leg==='supplier'?0:1
    if(consumer==='proof'){
      const sources=await build(f)
      await assert.rejects(f.load('builder').proveSources(f.f.conn,sources,f.load('engine'),1),e=>e.code==='ACCT_SUPPLIER_REFUND_VOUCHER_REQUIRED')
    }else if(consumer==='postcommit'){
      assert.equal((await f.load('postcommit').afterReceiveCommit(f.ack)).status,'pending')
      assert.equal(f.data.supplier_refund_orders[0].voucher_id,null)
    }else{
      await assert.rejects(f.load('period').closePeriod('202610',{userId:9},1),e=>e.code==='ACCT_SUPPLIER_REFUND_VOUCHER_REQUIRED')
      assert.equal(f.data.acct_periods.length,0)
    }
    assert.deepEqual(f.data.acct_vouchers,vouchers)
    assert.deepEqual(f.data.finance_account_transactions,funds)
    assert.deepEqual(f.data.payment_records,ap)
  })
}


test('actual generated result is stored and exposed by real RF detail route without changing receive ACK',async()=>{
  const f=await fixture(),ack=copy(f.ack),funds=copy(f.data.finance_account_transactions),ap=copy(f.data.payment_records)
  const result=await f.load('postcommit').afterReceiveCommit(f.ack)
  assert.equal(result.status,'generated')
  let response
  const controller=entry('modules/refunds/supplier-refunds.controller.js',{
    './supplier-refunds.service':f.f.module('service'),
    '../../utils/response':require('../backend/src/utils/response'),'../../utils/requestKey':require('../backend/src/utils/requestKey'),
  })
  const res={status:()=>res,json:body=>{response=body}}
  await controller.detail({params:{id:String(f.ack.id)},user:{userId:9}},res,error=>{throw error})
  assert.equal(response.data.voucher_id,result.voucherId)
  assert.equal(response.data.voucher_generate_error,null)
  assert.equal(Object.hasOwn(response.data,'voucher_generated_at'),false)
  assert.equal((await f.f.module('service').findAll({},9)).list[0].id,f.ack.id)
  assert.deepEqual(copy(f.ack),ack);assert.deepEqual(f.data.finance_account_transactions,funds);assert.deepEqual(f.data.payment_records,ap)
  assert.deepEqual(f.schemaViolations,[])
})
test('actual complete zero-cent result persists nullable voucher ID and explicit verified text',async()=>{
  const f=await fixture('0.0040'),funds=copy(f.data.finance_account_transactions),ap=copy(f.data.payment_records),ack=copy(f.ack)
  assert.equal((await f.load('postcommit').afterReceiveCommit(f.ack)).status,'notRequired')
  const row=await f.f.module('service').findById(f.ack.id,9)
  assert.equal(row.voucher_id,null);assert.equal(row.voucher_generate_error,'零分投影已核对/无需凭证')
  assert.equal(f.data.acct_vouchers.length,0);assert.deepEqual(f.schemaViolations,[])
  assert.deepEqual(copy(f.ack),ack);assert.deepEqual(f.data.finance_account_transactions,funds);assert.deepEqual(f.data.payment_records,ap)
})
test('actual pending error saves at most real 500 characters without cash or ACK change',async()=>{
  const f=await fixture(),funds=copy(f.data.finance_account_transactions),ap=copy(f.data.payment_records),ack=copy(f.ack)
  f.fail.match='INSERT INTO acct_vouchers';f.fail.errorMessage='fixture write failure '+ '核对'.repeat(300)
  assert.equal((await f.load('postcommit').afterReceiveCommit(f.ack)).status,'pending')
  const row=await f.f.module('service').findById(f.ack.id,9)
  assert.equal(row.voucher_id,null);assert.equal(row.voucher_generate_error.length,500)
  assert.ok(row.voucher_generate_error.startsWith('fixture write failure'))
  assert.deepEqual(f.schemaViolations,[]);assert.equal(f.data.acct_vouchers.length,0)
  assert.deepEqual(copy(f.ack),ack);assert.deepEqual(f.data.finance_account_transactions,funds);assert.deepEqual(f.data.payment_records,ap)
})
test('actual result/error save failure stays pending with original metadata and money intact',async()=>{
  const f=await fixture(),funds=copy(f.data.finance_account_transactions),ap=copy(f.data.payment_records),ack=copy(f.ack)
  f.fail.match='UPDATE supplier_refund_orders SET voucher_'
  assert.equal((await f.load('postcommit').afterReceiveCommit(f.ack)).status,'pending')
  assert.equal(f.data.supplier_refund_orders[0].voucher_id,null)
  assert.equal(f.data.supplier_refund_orders[0].voucher_generate_error,'凭证待生成')
  assert.equal(f.data.acct_vouchers.length,0);assert.deepEqual(f.schemaViolations,[])
  assert.deepEqual(copy(f.ack),ack);assert.deepEqual(f.data.finance_account_transactions,funds);assert.deepEqual(f.data.payment_records,ap)
})
