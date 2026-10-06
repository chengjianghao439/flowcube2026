'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {fixture,required,input,money}=require('./helpers/supplier-refunds-fixture')
const source=async f=>required(f.module('service'),'getSource')(11,9)
test('direct payment source uses exact positive entry/PO number and historical account',async()=>{const f=fixture(),r=await source(f);assert.equal(r.grossAmount,'6.0000');assert.equal(r.entries[0].entryId,21);assert.equal(r.entries[0].originalAmount,'100.0000');assert.equal(r.entries[0].availableAmount,'100.0000')})
test('receipt settlement with NULL entry account is valid using whole receipt/OUT proof',async()=>{
 const f=fixture({mutate:d=>{Object.assign(d.payment_entries[0],{account_id:null,receipt_id:71,amount:'50.0000'});d.payment_receipts=[{id:71,receipt_no:'PY71',type:1,party_id:4,account_id:41,amount:'100.0000',payment_date:'2026-10-01',settled_amount:'90.0000',balance:'10.0000'}];Object.assign(d.finance_account_transactions[0],{biz_id:71,biz_no:'PY71'})}})
 assert.equal((await source(f)).entries[0].availableAmount,'50.0000')
})
for(const defect of ['poi','unit','price','headGross','manualAP','missingAccount','wrongOUTno','duplicateOUT','receiptOverallocated'])test('accurate source rejects '+defect,async()=>{
 const f=fixture({mutate:d=>{
  if(defect==='poi')d.purchase_return_items[0].purchase_item_id=null
  if(defect==='unit')d.purchase_order_items[0].unit='箱'
  if(defect==='price')d.purchase_order_items[0].unit_price='4.0000'
  if(defect==='headGross')d.purchase_returns[0].total_amount='6.0001'
  if(defect==='manualAP')d.payment_records[0].order_id=null
  if(defect==='missingAccount')d.finance_accounts=d.finance_accounts.filter(r=>r.id!==41)
  if(defect==='wrongOUTno')d.finance_account_transactions[0].biz_no='PY21'
  if(defect==='duplicateOUT')d.finance_account_transactions.push({...d.finance_account_transactions[0],id:52})
  if(defect==='receiptOverallocated'){Object.assign(d.payment_entries[0],{receipt_id:71,account_id:null});d.payment_receipts=[{id:71,receipt_no:'PY71',type:1,party_id:4,account_id:41,amount:'90.0000',payment_date:'2026-10-01'}];Object.assign(d.finance_account_transactions[0],{biz_id:71,biz_no:'PY71',amount:'90.0000'})}
 }})
 await assert.rejects(source(f),e=>e.code==='SUPPLIER_REFUND_SOURCE_INVALID')
})
test('whole six-place quantity×price rounds once, not rounded line sum',async()=>{
 const f=fixture({mutate:d=>{d.purchase_returns[0].total_amount='0.0001';d.purchase_return_items=[1,2].map((id)=>({...d.purchase_return_items[0],id,quantity:'0.01',unit_price:'0.0049',amount:'0.0000'}));d.purchase_order_items[0].unit_price='0.0049'}})
 assert.equal((await source(f)).grossAmount,'0.0001')
})
test('0.0001 reserved/received overrun is rejected and draft allocation does not consume',async()=>{
 const f=fixture({mutate:d=>{d.supplier_refund_allocations=[{id:99,refund_id:99,payment_record_id:31,purchase_return_id:11,entry_id:21,amount:'2.0001',budget_state:'reserved'}]}})
 const b=input();b.amount='4.0000';await assert.rejects(required(f.module('service'),'create')(b,f.options),e=>e.code==='SUPPLIER_REFUND_BUDGET_EXCEEDED')
 f.data.supplier_refund_allocations[0].budget_state='draft';assert.equal((await source(f)).availableAmount,'6.0000')
})
test('strict money text remains four place and malformed actor scope never means all',()=>{assert.equal(money.moneyText(money.moneyUnits('0.0001')),'0.0001');const f=fixture(),actor=f.module('actor');const assertScope=required(actor,'assertScope');assert.throws(()=>assertScope({scopeLoaded:false},8));assert.throws(()=>assertScope({scopeLoaded:true,warehouseIds:undefined},8));assert.doesNotThrow(()=>assertScope({scopeLoaded:true,warehouseIds:null},8));assert.throws(()=>assertScope({scopeLoaded:true,warehouseIds:[]},8))})

test('actual DATE rule retains Beijing midnight and rejects invalid/calendar-overflow dates',()=>{
 const rules=fixture().module('rules')
 assert.equal(rules.date(new Date('2026-10-01T00:00:00+08:00')),'2026-10-01')
 for(const invalid of [new Date(NaN),'2026-02-30','not-a-date','2026-10-01T00:00:00Z'])assert.throws(()=>rules.date(invalid),e=>e.code==='SUPPLIER_REFUND_SOURCE_INVALID')
})
test('actual source preserves mysql DATE day and OUT Beijing datetime day',async()=>{
 const f=fixture()
 // Insert actual Date instances after the fixture snapshot clone; query copy converts to JSON text,
 // so this test models mysql projection Date by wrapping the exact two reads.
 const query=f.conn.query
 f.conn.query=async(sql,args)=>{const result=await query(sql,args);if(sql.includes('FROM payment_entries')||sql.includes('FROM finance_account_transactions'))for(const row of result[0]){if(row.payment_date)row.payment_date=new Date('2026-10-01T00:00:00+08:00');if(row.happened_at)row.happened_at=new Date('2026-10-01T00:00:00+08:00')}return result}
 assert.equal((await source(f)).entries[0].paymentDate,'2026-10-01')
})

test('independent entry/receipt counters may share ID when both full parent and exact OUT triples are valid',async()=>{
 const f=fixture({mutate:d=>{
  d.payment_records[0].total_amount='200.0000';d.payment_records[0].paid_amount='200.0000'
  d.payment_receipts.push({id:21,receipt_no:'PY21',type:1,party_id:4,account_id:41,amount:'100.0000',payment_date:'2026-10-01',settled_amount:'100.0000',balance:'0.0000'})
  d.payment_entries.push({id:22,record_id:31,amount:'100.0000',receipt_id:21,account_id:null,statement_id:null,payment_date:'2026-10-01'})
  d.finance_account_transactions.push({...d.finance_account_transactions[0],id:52,biz_id:21,biz_no:'PY21'})
 }})
 const result=await source(f)
 assert.equal(result.entries.length,2)
 assert.equal(result.entries[0].entryId,21);assert.equal(result.entries[0].receiptId,null);assert.equal(result.entries[0].out.id,51);assert.equal(result.entries[0].out.bizNo,'PO10')
 assert.equal(result.entries[1].entryId,22);assert.equal(result.entries[1].entryAccountId,null);assert.equal(result.entries[1].receiptId,21);assert.equal(result.entries[1].out.id,52);assert.equal(result.entries[1].out.bizNo,'PY21')
 for(const entry of result.entries){assert.equal(entry.originalAmount,'100.0000');assert.equal(entry.out.amount,'100.0000');assert.equal(entry.payerAccountId,41)}
})
test('same AP entry reserved by another PR consumes exact original principal, no epsilon',async()=>{
 const f=fixture({mutate:d=>{d.payment_entries[0].amount='5.0000';d.finance_account_transactions[0].amount='5.0000';d.supplier_refund_allocations=[{id:99,refund_id:99,payment_record_id:31,purchase_return_id:98,entry_id:21,amount:'1.0001',budget_state:'reserved'}]}})
 await assert.rejects(required(f.module('service'),'create')(input(),f.options),e=>e.code==='SUPPLIER_REFUND_BUDGET_EXCEEDED')
})


test('duplicate exact OUT triple is refused before choosing a row by money/account/date',async()=>{
 const f=fixture({mutate:d=>d.finance_account_transactions.push({...d.finance_account_transactions[0],id:52,account_id:999,amount:'0.0001',happened_at:'2026-10-02'})})
 await assert.rejects(source(f),e=>e.code==='SUPPLIER_REFUND_SOURCE_INVALID')
})
