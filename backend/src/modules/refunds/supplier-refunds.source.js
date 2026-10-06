'use strict'
const rules=require('./supplier-refunds.rules')
const actor=require('./supplier-refunds.actor')
const {moneyUnits,moneyText}=require('../../utils/decimalMoney')
const AppError=require('../../utils/AppError')
const invalid=rules.fail
async function peek(conn,id) {
  const [[pr]]=await conn.query('SELECT id, purchase_order_id, supplier_id, warehouse_id FROM purchase_returns WHERE id=?',[id])
  if(!pr)throw invalid()
  rules.safeId(pr.purchase_order_id);rules.safeId(pr.supplier_id);rules.safeId(pr.warehouse_id)
  return pr
}
async function heads(conn,located,currentActor,current=true) {
  const [[po]]=await conn.query('SELECT * FROM purchase_orders WHERE id=?'+(current?' FOR SHARE':''),[rules.safeId(located.purchase_order_id)])
  const [[pr]]=await conn.query('SELECT * FROM purchase_returns WHERE id=?'+(current?' FOR UPDATE':''),[rules.safeId(located.id)])
  if(!po || !pr || Number(pr.purchase_order_id)!==Number(po.id) || Number(pr.purchase_order_id)!==Number(located.purchase_order_id)
    || Number(pr.supplier_id)!==Number(po.supplier_id) || Number(pr.supplier_id)!==Number(located.supplier_id)
    || Number(pr.warehouse_id)!==Number(po.warehouse_id) || Number(pr.warehouse_id)!==Number(located.warehouse_id)
    || !pr.return_no || !po.order_no || pr.purchase_order_no!==po.order_no || po.deleted_at || pr.deleted_at)throw invalid()
  actor.assertScope(currentActor,po.warehouse_id);actor.assertScope(currentActor,pr.warehouse_id)
  const [items]=await conn.query('SELECT * FROM purchase_return_items WHERE return_id=? ORDER BY id'+(current?' FOR SHARE':''),[pr.id])
  const [original]=await conn.query('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY id'+(current?' FOR SHARE':''),[po.id])
  if(!items.length)throw invalid()
  const byId=new Map(original.map(row=>[Number(row.id),row]))
  let six=0n
  const frozen=items.map(row=>{
    const source=byId.get(Number(row.purchase_item_id)),qty=rules.quantityUnits(row.quantity),price=moneyUnits(row.unit_price)
    if(!source || Number(row.return_id)!==Number(pr.id) || Number(source.order_id)!==Number(po.id) || Number(row.product_id)!==Number(source.product_id)
      || !row.unit || row.unit!==source.unit || price<0n || price!==moneyUnits(source.unit_price))throw invalid()
    rules.safeId(row.id);rules.safeId(row.product_id);rules.safeId(row.purchase_item_id)
    six+=qty*price
    return{id:Number(row.id),purchaseItemId:Number(row.purchase_item_id),productId:Number(row.product_id),unit:row.unit,quantity:`${qty/100n}.${String(qty%100n).padStart(2,'0')}`,unitPrice:moneyText(price)}
  }).sort((a,b)=>a.id-b.id)
  // Quantity 2dp × price 4dp = six-place integer, round only the whole document.
  const gross=(six+50n)/100n
  if(gross<=0n || moneyUnits(pr.total_amount)!==gross)throw invalid('原退货头金额与准确原价基本量不一致，请人工核对')
  return{po,pr,gross,itemLabels:items.map(row=>({id:Number(row.id),productCode:row.product_code??null,productName:row.product_name??null,articleNumber:row.article_number??null,spec:row.spec??null,color:row.color??null})),identity:{version:1,po:{id:Number(po.id),orderNo:po.order_no,supplierId:Number(po.supplier_id),warehouseId:Number(po.warehouse_id)},pr:{id:Number(pr.id),returnNo:pr.return_no,purchaseOrderId:Number(po.id),purchaseOrderNo:pr.purchase_order_no,supplierId:Number(pr.supplier_id),warehouseId:Number(pr.warehouse_id),grossAmount:moneyText(gross),items:frozen}}}
}
async function payments(conn,context,current=true,selectedIds=null,{currentStatements=false}={}) {
  const {po}=context
  const [candidateAP]=await conn.query('SELECT * FROM payment_records WHERE type=1 AND order_id=? ORDER BY id',[po.id])
  if(candidateAP.length!==1 || candidateAP[0].order_no!==po.order_no)throw invalid()
  const apId=rules.safeId(candidateAP[0].id)
  const [peekEntries]=await conn.query('SELECT * FROM payment_entries WHERE record_id=? AND amount>0 ORDER BY id',[apId])
  if(!peekEntries.length)throw invalid('没有准确正额原付款分配，请人工核对')
  const intended=selectedIds?peekEntries.filter(row=>selectedIds.includes(Number(row.id))):peekEntries
  if(!intended.length || selectedIds&&intended.length!==selectedIds.length)throw invalid()
  const receiptIds=[...new Set(intended.filter(row=>row.receipt_id!=null).map(row=>rules.safeId(row.receipt_id)))].sort((a,b)=>a-b)
  const [membership]=currentStatements?await conn.query('SELECT statement_id FROM reconciliation_statement_items WHERE record_id=? ORDER BY statement_id, id',[apId]):[[]]
  const statementIds=[...new Set([...intended.filter(row=>row.statement_id!=null).map(row=>rules.safeId(row.statement_id)),...membership.map(row=>rules.safeId(row.statement_id))])].sort((a,b)=>a-b)
  const [beforeMembers]=currentStatements&&statementIds.length?await conn.query('SELECT statement_id, record_id FROM reconciliation_statement_items WHERE statement_id IN (?) ORDER BY statement_id, record_id, id',[statementIds]):[[]]
  const [receipts]=receiptIds.length?await conn.query('SELECT * FROM payment_receipts WHERE id IN (?) ORDER BY id'+(current?' FOR UPDATE':''),[receiptIds]):[[]]
  const [statements]=statementIds.length?await conn.query('SELECT * FROM reconciliation_statements WHERE id IN (?) ORDER BY id'+(current?' FOR UPDATE':''),[statementIds]):[[]]
  if(receipts.length!==receiptIds.length || statements.length!==statementIds.length)throw invalid()
  const receiptMap=new Map(receipts.map(row=>[Number(row.id),row]))
  const accounts=[...new Set(intended.map(row=>rules.safeId(row.receipt_id!=null?receiptMap.get(Number(row.receipt_id))?.account_id:row.account_id)))].sort((a,b)=>a-b)
  // Original payer account/OUT are proof, not new cash resources: no locks and no hard FK.
  const [payers]=await conn.query('SELECT * FROM finance_accounts WHERE id IN (?) ORDER BY id',[accounts])
  if(payers.length!==accounts.length || payers.some(row=>Number(row.company_id)!==1))throw invalid()
  const bizIds=[...new Set(intended.map(row=>rules.safeId(row.receipt_id??row.id)))].sort((a,b)=>a-b)
  const numbers=[...new Set([po.order_no,...receipts.map(row=>row.receipt_no)])]
  const [outgoing]=await conn.query('SELECT * FROM finance_account_transactions WHERE biz_type=2 AND (biz_id IN (?) OR biz_no IN (?)) ORDER BY id',[bizIds,numbers])
  const [receiptEntries]=receiptIds.length?await conn.query('SELECT * FROM payment_entries WHERE receipt_id IN (?) AND amount>0 ORDER BY id',[receiptIds]):[[]]
  for(const receipt of receipts){
    if(Number(receipt.type)!==1 || Number(receipt.party_id)!==Number(po.supplier_id) || !receipt.receipt_no || moneyUnits(receipt.amount)<=0n)throw invalid()
    const allocated=receiptEntries.filter(e=>Number(e.receipt_id)===Number(receipt.id)).reduce((sum,e)=>sum+moneyUnits(e.amount),0n)
    if(allocated>moneyUnits(receipt.amount))throw invalid('原汇款分配已超原本金，请人工核对')
  }
  for(const statement of statements)if(Number(statement.type)!==1 || statement.deleted_at)throw invalid()
  const [[ap]]=await conn.query('SELECT * FROM payment_records WHERE id=?'+(current?' FOR UPDATE':''),[apId])
  if(!ap || Number(ap.type)!==1 || Number(ap.order_id)!==Number(po.id) || ap.order_no!==po.order_no)throw invalid()
  if(currentStatements){
    const [currentMembership]=await conn.query('SELECT statement_id FROM reconciliation_statement_items WHERE record_id=? ORDER BY statement_id, id FOR SHARE',[apId])
    if(rules.stableJson(currentMembership.map(r=>rules.safeId(r.statement_id)))!==rules.stableJson(membership.map(r=>rules.safeId(r.statement_id))))throw invalid('当前对账成员已变化，请刷新后核对')
    const [currentMembers]=statementIds.length?await conn.query('SELECT statement_id, record_id FROM reconciliation_statement_items WHERE statement_id IN (?) ORDER BY statement_id, record_id, id FOR SHARE',[statementIds]):[[]]
    if(rules.stableJson(currentMembers)!==rules.stableJson(beforeMembers))throw invalid('当前对账成员已变化，请刷新后核对')
    const memberIds=[...new Set(currentMembers.map(r=>rules.safeId(r.record_id)))].sort((a,b)=>a-b)
    const [memberAPs]=memberIds.length?await conn.query('SELECT id, type FROM payment_records WHERE id IN (?) ORDER BY id FOR SHARE',[memberIds]):[[]]
    if(memberAPs.length!==memberIds.length||memberAPs.some(r=>Number(r.type)!==1))throw invalid('当前对账账款不完整，请人工核对')
  }
  const [entries]=await conn.query('SELECT * FROM payment_entries WHERE record_id=? AND amount>0 ORDER BY id'+(current?' FOR SHARE':''),[apId])
  const proofs=intended.map(before=>{
    const entry=entries.find(row=>Number(row.id)===Number(before.id))
    if(!entry || Number(entry.record_id)!==apId || entry.receipt_id!==before.receipt_id || entry.statement_id!==before.statement_id || entry.account_id!==before.account_id || moneyUnits(entry.amount)!==moneyUnits(before.amount))throw invalid('原付款分配身份已变化，请重新核对')
    const receipt=entry.receipt_id!=null?receiptMap.get(Number(entry.receipt_id)):null
    const accountId=rules.safeId(receipt?receipt.account_id:entry.account_id),bizId=rules.safeId(receipt?receipt.id:entry.id),bizNo=receipt?receipt.receipt_no:po.order_no
    const amount=moneyText(moneyUnits(receipt?receipt.amount:entry.amount)),paymentDate=rules.date(receipt?receipt.payment_date:entry.payment_date)
    // Both numeric identity and exact original document number are required; no ID/name fallback.
    const matches=outgoing.filter(row=>Number(row.biz_type)===2&&Number(row.biz_id)===bizId&&row.biz_no===bizNo)
    if(matches.length!==1)throw invalid('原付款流水缺失或不唯一，请人工核对')
    const out=matches[0]
    if(Number(out.direction)!==2 || Number(out.account_id)!==accountId || moneyText(moneyUnits(out.amount))!==amount || rules.date(out.happened_at)!==paymentDate)throw invalid()
    return{entryId:rules.safeId(entry.id),recordId:apId,originalAmount:moneyText(moneyUnits(entry.amount)),receiptId:receipt?Number(receipt.id):null,statementId:entry.statement_id==null?null:rules.safeId(entry.statement_id),entryAccountId:entry.account_id==null?null:rules.safeId(entry.account_id),paymentDate:rules.date(entry.payment_date),payerAccountId:accountId,companyId:1,receipt:receipt?{id:Number(receipt.id),receiptNo:receipt.receipt_no,type:1,supplierId:Number(receipt.party_id),accountId,amount,paymentDate}:null,out:{id:rules.safeId(out.id),accountId,direction:2,bizType:2,bizId,bizNo,amount,paymentDate}}
  })
  return{...context,ap,proofs,...(currentStatements?{statementIds}:{}),identity:{...context.identity,ap:{id:apId,type:1,orderId:Number(po.id),orderNo:po.order_no}}}
}
async function budget(conn,context,current=true) {
  const [rows]=await conn.query('SELECT * FROM supplier_refund_allocations WHERE payment_record_id=? ORDER BY id'+(current?' FOR UPDATE':''),[context.ap.id])
  let prConsumed=0n
  const used=new Map()
  for(const row of rows){
    if(!['draft','reserved','received','released'].includes(row.budget_state))throw invalid()
    const amount=moneyUnits(row.amount);if(amount<=0n)throw invalid()
    if(!['reserved','received'].includes(row.budget_state))continue
    used.set(Number(row.entry_id),(used.get(Number(row.entry_id))||0n)+amount)
    if(Number(row.purchase_return_id)===Number(context.pr.id))prConsumed+=amount
  }
  const free=context.gross-prConsumed
  if(free<0n)throw new AppError('原退货退款额度已超，请人工核对',409,'SUPPLIER_REFUND_BUDGET_EXCEEDED')
  const entries=context.proofs.map(row=>{
    const available=moneyUnits(row.originalAmount)-(used.get(row.entryId)||0n)
    if(available<0n)throw new AppError('原付款退款额度已超，请人工核对',409,'SUPPLIER_REFUND_BUDGET_EXCEEDED')
    return{...row,availableAmount:moneyText(available)}
  })
  return{free,entries,rows}
}
function assertBudget(context,budget,amount,allocations,ownId=null) {
  let own=0n
  const ownEntries=new Map()
  for(const row of budget.rows)if(Number(row.refund_id)===ownId&&row.budget_state==='reserved'){own+=moneyUnits(row.amount);ownEntries.set(Number(row.entry_id),(ownEntries.get(Number(row.entry_id))||0n)+moneyUnits(row.amount))}
  if(moneyUnits(amount)>budget.free+own || moneyUnits(amount)>moneyUnits(context.ap.paid_amount))throw new AppError('退款超过原退货额度或当前已付金额',409,'SUPPLIER_REFUND_BUDGET_EXCEEDED')
  for(const allocation of allocations){const entry=budget.entries.find(row=>row.entryId===allocation.entryId);if(!entry || moneyUnits(allocation.amount)>moneyUnits(entry.availableAmount)+(ownEntries.get(allocation.entryId)||0n))throw new AppError('退款超过准确原付款分配剩余额度',409,'SUPPLIER_REFUND_BUDGET_EXCEEDED')}
}
function freeze(context,allocations) {
  return{...context.identity,entries:allocations.map(a=>context.proofs.find(row=>row.entryId===a.entryId)).sort((a,b)=>a.entryId-b.entryId)}
}
module.exports={peek,heads,payments,budget,assertBudget,freeze}
