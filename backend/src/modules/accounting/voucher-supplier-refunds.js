'use strict'
// Read committed immutable received evidence in batches. Caller owns company gate and connection.
const AppError=require('../../utils/AppError')
const {moneyUnits,moneyText}=require('../../utils/decimalMoney')
const {assertSqlIdentifier}=require('../../utils/sqlIdentifier')
const {normalizeSaleLegs}=require('./voucher-sale-money')
const {SOURCE_TYPES,DIR}=require('../../constants/voucherSource')
const rules=require('../refunds/supplier-refunds.rules')
const operations=require('../refunds/supplier-refunds.operations')
const backfillRules=require('../refunds/supplier-refunds.backfill-rules')
const fail=()=>new AppError('供应商退款已收来源不完整或身份已变化，请人工核对',409,'ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
const check=condition=>{if(!condition)throw fail()}
const ids=rows=>[...new Set(rows.map(Number))].sort((a,b)=>a-b)
const byId=rows=>new Map(rows.map(row=>[Number(row.id),row]))
const centsText=value=>`${value/100n}.${String(value%100n).padStart(2,'0')}`
function projectReceived({refund,fund,supplierName}) {
  const u=moneyUnits(refund.amount);check(u>0n)
  const cents=(u+50n)/100n,amount=centsText(cents)
  const voucherDate=rules.date(fund.voucher_date_override||fund.happened_at)
  const type=Number(refund.received_account_type);check([1,2,3,4,5].includes(type))
  return {refundId:Number(refund.id),amount4:moneyText(u),amount2:amount,notRequired:cents===0n,
    spec:{sourceType:SOURCE_TYPES.SUPPLIER_REFUND_IN,sourceId:Number(fund.id),sourceNo:refund.refund_no,voucherDate,
      summary:`供应商退款 ${supplierName}`+(fund.voucher_date_override?'（跨期补录）':''),
      legs:cents===0n?[]:[
        {code:type===2?'1001':'1002',direction:DIR.DEBIT,amount,summary:'供应商退款回款'},
        {code:'2202',direction:DIR.CREDIT,amount,auxType:1,auxId:Number(refund.supplier_id),auxName:supplierName,summary:'冲减净已付'},
      ]}}
}
function receivedIdentity(row,sets) {
  const {po,pr,pri,poi,ap,entries,receipts,receiptEntries,accounts,funds,allocations,ops}=sets
  const order=po.get(Number(row.purchase_order_id)),ret=pr.get(Number(row.purchase_return_id)),payable=ap.get(Number(row.payment_record_id))
  check(Number(row.status)===3&&Number(row.company_id)===1&&order&&ret&&payable&&[1,2,3,4].includes(Number(ret.status)))
  for(const value of [row.id,row.supplier_id,row.warehouse_id,row.income_account_id,row.received_by,row.created_by])rules.safeId(value)
  check(Number(order.id)===Number(ret.purchase_order_id)&&ret.purchase_order_no===order.order_no&&ret.return_no&&order.order_no
    &&Number(order.supplier_id)===Number(ret.supplier_id)&&Number(row.supplier_id)===Number(order.supplier_id)
    &&Number(row.warehouse_id)===Number(ret.warehouse_id)&&Number(row.warehouse_id)===Number(order.warehouse_id)
    &&Number(payable.type)===1&&Number(payable.order_id)===Number(order.id)&&payable.order_no===order.order_no&&row.received_at)
  const body=rules.createBody(JSON.parse(row.create_payload_json))
  check(rules.stableJson(body)===row.create_payload_json&&body.operationUuid===row.created_operation_uuid&&body.purchaseReturnId===Number(ret.id)
    &&body.incomeAccountId===Number(row.income_account_id)&&body.refundDate===rules.date(row.refund_date)&&body.amount===rules.positiveMoney(row.amount))
  const lines=pri.filter(item=>Number(item.return_id)===Number(ret.id))
  check(lines.length>0&&new Set(lines.map(item=>Number(item.id))).size===lines.length)
  let six=0n
  const items=lines.map(item=>{
    const original=poi.get(Number(item.purchase_item_id)),q=rules.quantityUnits(item.quantity),price=moneyUnits(item.unit_price)
    rules.safeId(item.id);rules.safeId(item.product_id);rules.safeId(item.purchase_item_id)
    check(original&&Number(original.order_id)===Number(order.id)&&Number(original.product_id)===Number(item.product_id)
      &&item.unit&&original.unit===item.unit&&price>=0n&&price===moneyUnits(original.unit_price))
    six+=q*price
    return{id:Number(item.id),purchaseItemId:Number(item.purchase_item_id),productId:Number(item.product_id),unit:item.unit,quantity:`${q/100n}.${String(q%100n).padStart(2,'0')}`,unitPrice:moneyText(price)}
  }).sort((a,b)=>a.id-b.id)
  const gross=(six+50n)/100n;check(gross>0n&&gross===moneyUnits(ret.total_amount))
  const ownEntries=entries.filter(e=>Number(e.record_id)===Number(payable.id))
  check(ownEntries.length>0)
  const proofs=body.allocations.map(allocation=>{
    const matches=ownEntries.filter(e=>Number(e.id)===allocation.entryId);check(matches.length===1)
    const entry=matches[0],receipt=entry.receipt_id==null?null:receipts.get(Number(entry.receipt_id))
    check(entry.receipt_id==null||receipt)
    const accountId=rules.safeId(receipt?receipt.account_id:entry.account_id),account=accounts.get(accountId)
    check(account&&Number(account.company_id)===1)
    const bizId=rules.safeId(receipt?receipt.id:entry.id),bizNo=receipt?receipt.receipt_no:order.order_no
    const principal=moneyUnits(receipt?receipt.amount:entry.amount),date=rules.date(receipt?receipt.payment_date:entry.payment_date)
    check(principal>0n&&moneyUnits(entry.amount)>0n)
    if(receipt){
      check(Number(receipt.type)===1&&Number(receipt.party_id)===Number(row.supplier_id)&&receipt.receipt_no)
      const consumed=receiptEntries.filter(e=>Number(e.receipt_id)===Number(receipt.id)).reduce((n,e)=>n+moneyUnits(e.amount),0n)
      check(consumed<=principal)
    }
    const outgoing=funds.filter(t=>Number(t.biz_type)===2&&Number(t.biz_id)===bizId&&t.biz_no===bizNo)
    check(outgoing.length===1)
    const out=outgoing[0]
    check(Number(out.direction)===2&&Number(out.account_id)===accountId&&moneyUnits(out.amount)===principal&&rules.date(out.happened_at)===date)
    return{entryId:Number(entry.id),recordId:Number(payable.id),originalAmount:moneyText(moneyUnits(entry.amount)),receiptId:receipt?Number(receipt.id):null,
      statementId:entry.statement_id==null?null:rules.safeId(entry.statement_id),entryAccountId:entry.account_id==null?null:rules.safeId(entry.account_id),
      paymentDate:rules.date(entry.payment_date),payerAccountId:accountId,companyId:1,
      receipt:receipt?{id:Number(receipt.id),receiptNo:receipt.receipt_no,type:1,supplierId:Number(receipt.party_id),accountId,amount:moneyText(principal),paymentDate:date}:null,
      out:{id:Number(out.id),accountId,direction:2,bizType:2,bizId,bizNo,amount:moneyText(principal),paymentDate:date}}
  }).sort((a,b)=>a.entryId-b.entryId)
  const identity={version:1,po:{id:Number(order.id),orderNo:order.order_no,supplierId:Number(order.supplier_id),warehouseId:Number(order.warehouse_id)},
    pr:{id:Number(ret.id),returnNo:ret.return_no,purchaseOrderId:Number(order.id),purchaseOrderNo:ret.purchase_order_no,supplierId:Number(ret.supplier_id),warehouseId:Number(ret.warehouse_id),grossAmount:moneyText(gross),items},
    ap:{id:Number(payable.id),type:1,orderId:Number(order.id),orderNo:order.order_no},entries:proofs}
  check(rules.stableJson(identity)===row.source_snapshot_json&&rules.fingerprint(row.source_snapshot_json)===row.source_fingerprint)
  const own=allocations.filter(a=>Number(a.refund_id)===Number(row.id))
  check(own.length===body.allocations.length&&new Set(own.map(a=>Number(a.entry_id))).size===own.length)
  let allocated=0n
  for(const a of own){
    const proof=proofs.find(p=>p.entryId===Number(a.entry_id)),part=body.allocations.find(p=>p.entryId===Number(a.entry_id));check(proof&&part)
    check(a.budget_state==='received'&&Number(a.payment_record_id)===Number(payable.id)&&Number(a.purchase_return_id)===Number(ret.id)
      &&moneyText(moneyUnits(a.amount))===part.amount&&a.source_snapshot_json===rules.stableJson(proof)
      &&Number(a.original_transaction_id)===proof.out.id&&Number(a.receipt_id??0)===Number(proof.receiptId??0))
    allocated+=moneyUnits(a.amount)
  }
  check(allocated===moneyUnits(row.amount))
  const income=accounts.get(Number(row.income_account_id));check(income&&Number(income.company_id)===1)
  const incoming=funds.filter(t=>Number(t.biz_type)===6&&Number(t.biz_id)===Number(row.id))
  check(incoming.length===1)
  const fund=incoming[0]
  check(Number(fund.id)===Number(row.fund_transaction_id)&&Number(fund.account_id)===Number(row.income_account_id)&&Number(fund.direction)===1
    &&typeof fund.party_name==='string'&&fund.party_name.trim().length>0&&fund.biz_no===row.refund_no&&moneyUnits(fund.amount)===moneyUnits(row.amount)&&rules.date(fund.happened_at)===body.refundDate)
  const created=ops.filter(o=>o.operation_uuid===row.created_operation_uuid);check(created.length===1)
  const creation=created[0]
  operations.assertIdentity(creation,rules.identity('supplier.refund.create',body,Number(row.created_by),row.request_key))
  check(Number(creation.status)===1&&creation.payload_hash===row.payload_hash);operations.response(creation,row)
  const receives=ops.filter(o=>o.action===`supplier.refund.receive.${row.id}`&&Number(o.refund_id)===Number(row.id)&&Number(o.status)===1)
  check(receives.length===1)
  const received=receives[0],payload=JSON.parse(received.payload_json)
  check(Number(received.actor_id)===Number(row.received_by))
  const {id:receivedId,...receivedAction}=payload
  check(receivedId===Number(row.id))
  const receivedBody={...rules.actionBody(receivedAction),id:Number(row.id)}
  operations.assertIdentity(received,rules.identity(received.action,receivedBody,Number(row.received_by),received.request_key));operations.response(received,row)
  if(fund.backfill_id!=null||fund.voucher_date_override!=null){
    const application=sets.backfills.get(rules.safeId(fund.backfill_id));check(application)
    const applicationFunds=sets.backfillFunds.filter(t=>Number(t.backfill_id)===Number(application.id))
    check(applicationFunds.length===1&&Number(applicationFunds[0].id)===Number(fund.id))
    backfillRules.assertFund(application,row,fund,received)
  }
  return {row,fund,gross,payable,supplierName:fund.party_name,allocated}
}
async function loadSources(conn,{companyId=1,fundId=null,period=null}={}) {
  const cid=rules.safeId(companyId);if(cid!==1)return []
  const requested=fundId==null?null:rules.safeId(fundId)
  const [driven]=await conn.query(`SELECT t.* FROM finance_account_transactions t
    LEFT JOIN finance_accounts a ON a.id=t.account_id
    LEFT JOIN supplier_refund_orders r ON r.fund_transaction_id=t.id
    WHERE t.biz_type=6 AND (a.company_id=? OR r.company_id=? OR a.id IS NULL OR r.id IS NULL)${requested?' AND t.id=?':''}
    ORDER BY t.id /* supplier-refund-facts */`,requested?[cid,cid,requested]:[cid,cid])
  const [receivedRows]=await conn.query('SELECT * FROM supplier_refund_orders WHERE company_id=? AND status=3'+(requested?' AND fund_transaction_id=?':'')+' ORDER BY id',requested?[cid,requested]:[cid])
  if(requested)check(driven.length===1&&receivedRows.length===1)
  const selectedFunds=period?driven.filter(t=>rules.date(t.voucher_date_override||t.happened_at).replaceAll('-','').slice(0,6)===period):driven
  const selectedRows=period?receivedRows.filter(r=>{const t=driven.find(t=>Number(t.id)===Number(r.fund_transaction_id));return rules.date(t?.voucher_date_override||t?.happened_at||r.refund_date).replaceAll('-','').slice(0,6)===period}):receivedRows
  if(!selectedFunds.length&&!selectedRows.length)return []
  const selectedIds=ids([...selectedFunds.map(t=>rules.safeId(t.biz_id)),...selectedRows.map(r=>r.id)])
  const batch=async(table,column,values)=>values.length?(await conn.query(`SELECT * FROM ${assertSqlIdentifier(table)} WHERE ${assertSqlIdentifier(column)} IN (?) ORDER BY id`,[values]))[0]:[]
  // Table/column arguments are internal static names, never request fields.
  const [primary]=await conn.query('SELECT * FROM supplier_refund_orders WHERE id IN (?) OR fund_transaction_id IN (?) ORDER BY id',[selectedIds,ids(selectedFunds.map(t=>t.id))])
  check(primary.length===selectedIds.length)
  const all=await batch('supplier_refund_orders','payment_record_id',ids(primary.map(r=>r.payment_record_id)))
  const prRows=await batch('purchase_returns','id',ids(all.map(r=>r.purchase_return_id)))
  const poRows=await batch('purchase_orders','id',ids(all.map(r=>r.purchase_order_id)))
  const pri=await batch('purchase_return_items','return_id',ids(prRows.map(r=>r.id)))
  const poi=await batch('purchase_order_items','order_id',ids(poRows.map(r=>r.id)))
  const aps=await batch('payment_records','id',ids(all.map(r=>r.payment_record_id)))
  const entries=await batch('payment_entries','record_id',ids(aps.map(r=>r.id)))
  const allocations=await batch('supplier_refund_allocations','payment_record_id',ids(aps.map(r=>r.id)))
  const receiptRows=await batch('payment_receipts','id',ids(entries.filter(e=>e.receipt_id!=null).map(e=>e.receipt_id)))
  const receiptEntries=await batch('payment_entries','receipt_id',ids(receiptRows.map(r=>r.id)))
  const accountRows=await batch('finance_accounts','id',ids([...all.map(r=>r.income_account_id),...entries.filter(e=>e.account_id!=null).map(e=>e.account_id),...receiptRows.map(r=>r.account_id)]))
  const [incoming]=await conn.query('SELECT * FROM finance_account_transactions WHERE biz_type=6 AND biz_id IN (?) ORDER BY id',[ids(all.map(r=>r.id))])
  const [outgoing]=await conn.query('SELECT * FROM finance_account_transactions WHERE biz_type=2 AND (biz_id IN (?) OR biz_no IN (?)) ORDER BY id',[ids([...entries.filter(e=>e.receipt_id==null).map(e=>e.id),...receiptRows.map(r=>r.id)]),[...poRows.map(r=>r.order_no),...receiptRows.map(r=>r.receipt_no)]])
  const ops=await batch('supplier_refund_operations','refund_id',ids(all.map(r=>r.id)))
  const backfillIds=ids(incoming.filter(t=>t.backfill_id!=null).map(t=>rules.safeId(t.backfill_id)))
  const backfillRows=backfillIds.length?(await conn.query("SELECT *,DATE_FORMAT(approved_at,'%Y-%m-%d') AS approved_date FROM finance_period_backfills WHERE id IN (?) ORDER BY id",[backfillIds]))[0]:[]
  // A supplier-refund application owns exactly one FAT across all business types.
  const backfillFunds=await batch('finance_account_transactions','backfill_id',backfillIds)
  const sets={backfills:byId(backfillRows),backfillFunds,po:byId(poRows),pr:byId(prRows),pri,poi:byId(poi),ap:byId(aps),entries:entries.filter(e=>moneyUnits(e.amount)>0n),receipts:byId(receiptRows),receiptEntries:receiptEntries.filter(e=>moneyUnits(e.amount)>0n),accounts:byId(accountRows),funds:[...incoming,...outgoing],allocations,ops}
  let validated
  try{
    validated=all.filter(r=>Number(r.status)===3).map(r=>receivedIdentity(r,sets))
    const receivedAlloc=allocations.filter(a=>a.budget_state==='received')
    check(receivedAlloc.every(a=>validated.some(v=>Number(v.row.id)===Number(a.refund_id))))
    for(const entry of sets.entries){const used=receivedAlloc.filter(a=>Number(a.entry_id)===Number(entry.id)).reduce((n,a)=>n+moneyUnits(a.amount),0n);check(used<=moneyUnits(entry.amount))}
    for(const v of validated){const used=receivedAlloc.filter(a=>Number(a.purchase_return_id)===Number(v.row.purchase_return_id)).reduce((n,a)=>n+moneyUnits(a.amount),0n);check(used<=v.gross)}
    check(selectedIds.every(id=>validated.some(v=>Number(v.row.id)===id)))
    for(const fund of selectedFunds)check(validated.some(v=>Number(v.fund.id)===Number(fund.id)))
  }catch(error){if(error instanceof AppError||error.name==='SyntaxError')throw fail();throw error}
  return validated.filter(v=>selectedIds.includes(Number(v.row.id))).map(v=>({...projectReceived({refund:v.row,fund:v.fund,supplierName:v.supplierName}),backfillId:v.fund.backfill_id==null?null:rules.safeId(v.fund.backfill_id),paymentRecordId:Number(v.row.payment_record_id),
    originalPaid4:moneyText(sets.entries.filter(e=>Number(e.record_id)===Number(v.row.payment_record_id)).reduce((n,e)=>n+moneyUnits(e.amount),0n)),
    receivedPaid4:moneyText(allocations.filter(a=>a.budget_state==='received'&&Number(a.payment_record_id)===Number(v.row.payment_record_id)).reduce((n,a)=>n+moneyUnits(a.amount),0n)),currentPaid4:moneyText(moneyUnits(v.payable.paid_amount)),total4:moneyText(moneyUnits(v.payable.total_amount)),balance4:moneyText(moneyUnits(v.payable.balance))}))
}
async function proveSources(conn,sources,engine,companyId=1) {
  if(!sources.length)return []
  const ids=sources.map(s=>s.spec.sourceId)
  const [vouchers]=await conn.query('SELECT * FROM acct_vouchers WHERE company_id=? AND source_type=? AND source_id IN (?) ORDER BY id',[companyId,SOURCE_TYPES.SUPPLIER_REFUND_IN,ids])
  const accountMap=sources.some(s=>!s.notRequired)?await engine.loadAccountMap(conn,companyId):new Map()
  const [entries]=vouchers.length?await conn.query('SELECT * FROM acct_voucher_entries WHERE voucher_id IN (?) ORDER BY voucher_id, line_no',[vouchers.map(v=>v.id)]):[[]]
  return sources.map(source=>{
    const matches=vouchers.filter(v=>Number(v.source_id)===Number(source.spec.sourceId))
    const denied=()=>{throw new AppError('供应商退款凭证缺失、已冲销或与真实来源不符',409,'ACCT_SUPPLIER_REFUND_VOUCHER_REQUIRED')}
    if(source.notRequired){if(matches.length)denied();return{source,status:'notRequired'}}
    if(matches.length!==1)denied()
    const v=matches[0],legs=entries.filter(e=>Number(e.voucher_id)===Number(v.id)).sort((a,b)=>Number(a.line_no)-Number(b.line_no))
    const expected=source.spec.legs.map(l=>[l.code,Number(l.direction),l.amount,Number(l.auxType??0),l.auxId??null,l.auxName??null])
    const actual=legs.map(l=>{
      if(l.aux_type==null||moneyUnits(l.amount)%100n!==0n||Number(l.account_id)!==Number(accountMap.get(l.account_code)?.id))denied()
      return [l.account_code,Number(l.direction),centsText(moneyUnits(l.amount)/100n),Number(l.aux_type),l.aux_id==null?null:Number(l.aux_id),l.aux_name??null]
    })
    if(![1,2].includes(Number(v.status))||Number(v.is_reversal)!==0||v.source_period!==''||rules.date(v.voucher_date)!==source.spec.voucherDate
      ||v.source_no!==source.spec.sourceNo||v.period!==source.spec.voucherDate.replaceAll('-','').slice(0,6)||v.source_hash!==engine.hashSpec(source.spec.voucherDate,normalizeSaleLegs(source.spec.legs))
      ||moneyUnits(v.total_debit)!==moneyUnits(source.amount2)||moneyUnits(v.total_credit)!==moneyUnits(source.amount2)
      ||rules.stableJson(actual)!==rules.stableJson(expected))denied()
    return {source,status:'generated',voucherId:Number(v.id)}
  })
}
async function assertPeriodCurrent(conn,period,companyId=1) {
  const sources=await loadSources(conn,{companyId,period})
  return proveSources(conn,sources,require('./voucher-engine'),companyId)
}
function summarizeSources(sources) {
  let cash=0n,projected=0n,original=0n,received=0n,current=0n,balanceDiff=0n,mismatchedPaymentCount=0
  const payables=new Map()
  for(const source of sources){cash+=moneyUnits(source.amount4);projected+=moneyUnits(source.amount2);payables.set(source.paymentRecordId,source)}
  for(const source of payables.values()){
    const positive=moneyUnits(source.originalPaid4),refunded=moneyUnits(source.receivedPaid4),paid=moneyUnits(source.currentPaid4)
    original+=positive;received+=refunded;current+=paid
    const localBalanceDiff=moneyUnits(source.balance4)-(moneyUnits(source.total4)-paid)
    balanceDiff+=localBalanceDiff
    if(paid!==positive-refunded||localBalanceDiff!==0n)mismatchedPaymentCount++
  }
  const net=original-received,diff=current-net
  return{cashAmount4:moneyText(cash),projectedAmount2:centsText(projected/100n),roundingDifference4:moneyText(projected-cash),
    netPaid4:moneyText(net),currentPaid4:moneyText(current),paidDifference4:moneyText(diff),balanceDifference4:moneyText(balanceDiff),mismatchedPaymentCount,matched:mismatchedPaymentCount===0}
}
async function reconciliation(conn,companyId=1){return summarizeSources(await loadSources(conn,{companyId}))}
module.exports={loadSources,projectReceived,proveSources,assertPeriodCurrent,reconciliation,summarizeSources}
