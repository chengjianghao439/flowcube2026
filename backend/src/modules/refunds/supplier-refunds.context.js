'use strict'
const rules=require('./supplier-refunds.rules')
const actor=require('./supplier-refunds.actor')
const source=require('./supplier-refunds.source')
const operations=require('./supplier-refunds.operations')
const {moneyText,moneyUnits}=require('../../utils/decimalMoney')

async function company(conn,current) {
  const [[row]]=await conn.query('SELECT id FROM acct_companies WHERE id=?'+(current?' FOR SHARE':''),[1])
  if(!row || Number(row.id)!==1)throw rules.fail('账套身份不存在，请人工核对')
}
async function context(conn,id,currentActor,current) {
  try{return await source.heads(conn,await source.peek(conn,id),currentActor,current)}
  catch(e){if(e.code==='SUPPLIER_REFUND_INPUT_INVALID')throw rules.fail();throw e}
}
async function paymentContext(conn,ctx,current,entryIds,options) {
  try{return await source.payments(conn,ctx,current,entryIds,options)}
  catch(e){if(e.code==='SUPPLIER_REFUND_INPUT_INVALID')throw rules.fail();throw e}
}
async function income(conn,id,current,activeRequired,exclusive=false) {
  const [[row]]=await conn.query('SELECT * FROM finance_accounts WHERE id=?'+(current?(exclusive?' FOR UPDATE':' FOR SHARE'):''),[id])
  if(!row || Number(row.id)!==id || Number(row.company_id)!==1 || activeRequired&&(Number(row.is_active)!==1 || row.deleted_at))throw rules.fail('退款收入账户身份或可用性已变化，请核对')
  return row
}
async function head(conn,id,currentActor,current) {
  const [[row]]=await conn.query('SELECT * FROM supplier_refund_orders WHERE id=?'+(current?' FOR UPDATE':''),[id])
  if(!row || Number(row.id)!==id || Number(row.company_id)!==1)throw rules.fail('退款单不存在或身份异常')
  actor.assertScope(currentActor,row.warehouse_id)
  return row
}
function allocationsFromSnapshot(row) {
  let body
  try{body=JSON.parse(row.create_payload_json)}catch{throw operations.conflict()}
  if(rules.stableJson(body)!==row.create_payload_json)throw operations.conflict()
  const parsed=rules.createBody(body)
  if(rules.stableJson(parsed)!==row.create_payload_json || parsed.operationUuid!==row.created_operation_uuid || parsed.purchaseReturnId!==Number(row.purchase_return_id)
    || parsed.incomeAccountId!==Number(row.income_account_id) || parsed.refundDate!==rules.date(row.refund_date) || parsed.amount!==rules.positiveMoney(row.amount))throw operations.conflict()
  return parsed
}
async function frozenContext(conn,row,ctx,currentActor,current,options={}) {
  if(Number(row.purchase_order_id)!==Number(ctx.po.id) || Number(row.purchase_return_id)!==Number(ctx.pr.id) || Number(row.supplier_id)!==Number(ctx.po.supplier_id) || Number(row.warehouse_id)!==Number(ctx.pr.warehouse_id))throw operations.conflict()
  actor.assertScope(currentActor,row.warehouse_id)
  const body=allocationsFromSnapshot(row)
  const [[created]]=await conn.query('SELECT * FROM supplier_refund_operations WHERE operation_uuid=?'+(current?' FOR SHARE':''),[row.created_operation_uuid])
  if(!created || created.action!=='supplier.refund.create' || Number(created.actor_id)!==Number(row.created_by) || created.request_key!==row.request_key || created.payload_hash!==row.payload_hash || created.payload_json!==row.create_payload_json || Number(created.status)!==1)throw operations.conflict()
  operations.response(created,row)
  const incomeAccount=await income(conn,body.incomeAccountId,current,false,options.incomeExclusive===true)
  const payment=await paymentContext(conn,ctx,current,body.allocations.map(a=>a.entryId),options)
  const proof=rules.stableJson(source.freeze(payment,body.allocations))
  if(proof!==row.source_snapshot_json || rules.fingerprint(proof)!==row.source_fingerprint || Number(payment.ap.id)!==Number(row.payment_record_id))throw operations.conflict()
  const [own]=await conn.query('SELECT * FROM supplier_refund_allocations WHERE refund_id=? ORDER BY id'+(current?' FOR SHARE':''),[row.id])
  if(own.length!==body.allocations.length || own.some(a=>Number(a.purchase_return_id)!==Number(row.purchase_return_id) || Number(a.payment_record_id)!==Number(row.payment_record_id)
    || !body.allocations.some(b=>b.entryId===Number(a.entry_id)&&b.amount===moneyText(moneyUnits(a.amount))) || a.budget_state!==({1:'draft',2:'reserved',3:'received',4:'released'}[Number(row.status)]) || a.source_snapshot_json!==rules.stableJson(payment.proofs.find(p=>p.entryId===Number(a.entry_id))) || Number(a.original_transaction_id)!==Number(payment.proofs.find(p=>p.entryId===Number(a.entry_id))?.out.id) || Number(a.receipt_id??0)!==Number(payment.proofs.find(p=>p.entryId===Number(a.entry_id))?.receiptId??0)))throw operations.conflict()
  if(Number(row.status)===3){
    const fundId=Number(row.fund_transaction_id)
    if(!Number.isSafeInteger(fundId)||fundId<=0||![1,2,3,4,5].includes(Number(row.received_account_type))||!row.received_at||!row.received_by)throw operations.conflict()
    // This is immutable original IN evidence, not a late lock on other payer resources.
    const [funds]=await conn.query('SELECT * FROM finance_account_transactions WHERE biz_type=6 AND (biz_id=? OR id=?) ORDER BY id',[Number(row.id),fundId])
    if(funds.length!==1)throw operations.conflict()
    const fund=funds[0]
    if(Number(fund.id)!==fundId||Number(fund.biz_id)!==Number(row.id)||Number(fund.direction)!==1||Number(fund.account_id)!==body.incomeAccountId||fund.biz_no!==row.refund_no
      ||moneyText(moneyUnits(fund.amount))!==body.amount||rules.date(fund.happened_at)!==body.refundDate)throw operations.conflict()
  }
  return{payment,body,own,incomeAccount}
}
module.exports={company,context,paymentContext,income,head,allocationsFromSnapshot,frozenContext}
