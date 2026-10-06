'use strict'
const {pool}=require('../../config/db')
const AppError=require('../../utils/AppError')
const {PERMISSIONS:P}=require('../../constants/permissions')
const {assertStatusAction}=require('../../constants/documentStatusRules')
const {moneyText,moneyUnits}=require('../../utils/decimalMoney')
const finance=require('../finance/finance-accounts.service')
const statements=require('../payments/reconciliation-statements.service')
const paymentEvents=require('../payments/payment-events.service')
const {assertFinancePeriodOpen}=require('../accounting/finance-period.guard')
const rules=require('./supplier-refunds.rules')
const actor=require('./supplier-refunds.actor')
const source=require('./supplier-refunds.source')
const operations=require('./supplier-refunds.operations')
const context=require('./supplier-refunds.context')
const {afterReceiveCommit}=require('./supplier-refunds.postcommit')

function identity(refundId,raw,options) {
  const id=rules.safeId(refundId),body={...rules.actionBody(raw),id}
  return rules.identity(`supplier.refund.receive.${id}`,body,options.userId,options.requestKey)
}
function locatorOf(raw) {
  if(!raw)throw operations.conflict()
  return{purchaseOrderId:rules.safeId(raw.purchaseOrderId),purchaseReturnId:rules.safeId(raw.purchaseReturnId),refundDate:rules.date(raw.refundDate)}
}
// Read-only original acknowledgement lookup is separate from the new-write transaction.
async function lookupOwnedReceiveAck(refundId,raw,options,readOwn) {
  const id=identity(refundId,raw,options)
  const own=await readOwn(id.operationUuid,{action:id.action,requestKey:id.requestKey},id.userId,id)
  if(own.status==='not_found')return null
  if(own.status!=='success')throw new AppError('原回款操作仍待确认，请核对原结果',409,'SUPPLIER_REFUND_OPERATION_PENDING')
  return own.data
}

// Internal borrowed-connection entry. Caller supplies a server-owned immutable locator;
// this function never obtains a connection or controls transaction/isolation/lifecycle.
async function receiveInTransaction(conn,refundId,raw,options) {
  const id=identity(refundId,raw,options),fixed=locatorOf(options.locator)
  let closedPeriod=null,periodResult=null
  if(options.backfill){
    periodResult=await assertFinancePeriodOpen(conn,fixed.refundDate,{companyId:1,bizLabel:'供应商退款回款',backfill:options.backfill})
  }else{
    await context.company(conn,true)
    if(options.periodAlreadyLocked!==true){
      try{await assertFinancePeriodOpen(conn,fixed.refundDate,{companyId:1,bizLabel:'供应商退款回款',backfillHint:'supplier_refund'})}
      catch(error){if(error.code!=='FINANCE_PERIOD_CLOSED')throw error;closedPeriod=error}
    }
  }
  const currentActor=await actor.load(conn,id.userId)
  if(options.backfill){
    actor.authorize(currentActor,P.SUPPLIER_REFUND_RECEIVE)
    if(currentActor.roleId!==1&&!currentActor.permissions.includes(P.FINANCE_PERIOD_BACKFILL))throw new AppError('原申请人的跨期补录权限已撤回',403,'SUPPLIER_REFUND_AUTH_DENIED')
  }
  const [[po]]=await conn.query('SELECT * FROM purchase_orders WHERE id=? FOR SHARE',[fixed.purchaseOrderId])
  const [[pr]]=await conn.query('SELECT * FROM purchase_returns WHERE id=? FOR UPDATE',[fixed.purchaseReturnId])
  const row=await context.head(conn,rules.safeId(refundId),currentActor,true)
  if(!po||!pr||Number(row.purchase_order_id)!==fixed.purchaseOrderId||Number(row.purchase_return_id)!==fixed.purchaseReturnId
    ||Number(pr.purchase_order_id)!==fixed.purchaseOrderId||rules.date(row.refund_date)!==fixed.refundDate)throw operations.conflict()
  if(options.backfillSnapshot)require('./supplier-refunds.backfill-rules').assertFrozen(options.backfillSnapshot,row)
  const [[existing]]=await conn.query('SELECT * FROM supplier_refund_operations WHERE operation_uuid=? FOR SHARE',[id.operationUuid])
  if(existing){
    operations.assertIdentity(existing,id)
    if(Number(existing.status)!==1)throw new AppError('原回款操作仍待确认，请核对原结果',409,'SUPPLIER_REFUND_OPERATION_PENDING')
  }else{
    actor.authorize(currentActor,P.SUPPLIER_REFUND_RECEIVE)
    if(options.backfill&&currentActor.roleId!==1&&!currentActor.permissions.includes(P.FINANCE_PERIOD_BACKFILL))throw new AppError('原申请人的跨期补录权限已撤回',403,'SUPPLIER_REFUND_AUTH_DENIED')
    if(closedPeriod)throw closedPeriod
  }
  // All following ordinary proof reads occur after both company and confirmed RF current gates.
  const ctx=await source.heads(conn,{id:fixed.purchaseReturnId,purchase_order_id:fixed.purchaseOrderId,supplier_id:pr.supplier_id,warehouse_id:pr.warehouse_id},currentActor,true)
  const replay=existing||await operations.begin(conn,id)
  const frozen=await context.frozenContext(conn,row,ctx,currentActor,true,{incomeExclusive:true,currentStatements:!replay})
  if(replay){operations.assertIdentity(replay,id);return operations.response(replay,row)}
  assertStatusAction('supplierRefund','receive',row.status)
  if(Number(ctx.pr.status)!==1)throw rules.fail('仅准确采购退货草稿可登记新回款，请人工核对')
  const account=frozen.incomeAccount
  if(Number(account.company_id)!==1||Number(account.is_active)!==1||account.deleted_at||![1,2,3,4,5].includes(Number(account.type)))throw rules.fail('收入账户身份或可用性已变化，请核对')
  const amount=moneyUnits(row.amount)
  if(frozen.own.some(a=>a.budget_state!=='reserved')||new Set(frozen.own.map(a=>Number(a.entry_id))).size!==frozen.body.allocations.length
    ||frozen.own.reduce((sum,a)=>sum+moneyUnits(a.amount),0n)!==amount)throw operations.conflict()
  source.assertBudget(frozen.payment,await source.budget(conn,frozen.payment),row.amount,frozen.body.allocations,Number(row.id))
  const oldPaid=moneyUnits(frozen.payment.ap.paid_amount),paid=oldPaid-amount,total=moneyUnits(frozen.payment.ap.total_amount),balance=total-paid
  if(paid<0n||total<0n||balance<0n)throw new AppError('原应付金额异常，请人工核对',409,'SUPPLIER_REFUND_BUDGET_EXCEEDED')
  const result=await finance.recordTransaction(conn,{
    accountId:Number(row.income_account_id),direction:finance.DIRECTION.IN,bizType:finance.BIZ_TYPE.SUPPLIER_REFUND,bizId:Number(row.id),bizNo:row.refund_no,
    amount:moneyText(amount),partyName:ctx.po.supplier_name||ctx.pr.supplier_name,happenedAt:fixed.refundDate,remark:row.remark,
    ...(options.backfill?{voucherDateOverride:periodResult.voucherDateOverride,backfillId:rules.safeId(options.backfill.approvedId)}:{}),
  },{operatorId:currentActor.userId,operatorName:currentActor.realName})
  const fundId=rules.safeId(result.id)
  const [updated]=await conn.query('UPDATE payment_records SET paid_amount=?,balance=?,status=? WHERE id=? AND paid_amount=?',[
    moneyText(paid),moneyText(balance),balance===0n?3:paid>0n?2:1,frozen.payment.ap.id,moneyText(oldPaid),
  ])
  if(updated.affectedRows!==1)throw operations.conflict()
  const [allocated]=await conn.query('UPDATE supplier_refund_allocations SET budget_state=? WHERE refund_id=? AND budget_state=?',['received',row.id,'reserved'])
  if(allocated.affectedRows!==frozen.own.length)throw operations.conflict()
  for(const statementId of frozen.payment.statementIds)await statements.refreshSettlement(conn,statementId,{currentRead:true,exactMoney:true})
  await conn.query('INSERT INTO party_ledger_events (type,party_id,party_name,record_id,order_id,document_no,event_type,delta,business_date,baseline_key) VALUES (?,?,?,?,?,?,?,?,?,?)',[
    1,Number(row.supplier_id),ctx.po.supplier_name||ctx.pr.supplier_name,Number(row.payment_record_id),Number(row.purchase_order_id),row.refund_no,'SUPPLIER_REFUND_IN',moneyText(amount),fixed.refundDate,`supplier_refund:${row.id}`,
  ])
  await paymentEvents.record(conn,{
    paymentRecordId:Number(row.payment_record_id),orderNo:row.refund_no,eventType:'SUPPLIER_REFUND_RECEIVED',title:'供应商退款已收到',
    description:'已登记实际回款，原付款分配保持不变；凭证结果见退款详情',operatorId:currentActor.userId,operatorName:currentActor.realName,requestId:id.operationUuid,
    payload:{refundId:Number(row.id),refundNo:row.refund_no,fundTransactionId:fundId,amount:moneyText(amount),operationUuid:id.operationUuid},
  })
  const [received]=await conn.query('UPDATE supplier_refund_orders SET status=3,received_by=?,received_at=NOW(),received_account_type=?,fund_transaction_id=?,voucher_generate_error=? WHERE id=? AND status=?',[
    currentActor.userId,Number(account.type),fundId,'凭证待生成',Number(row.id),2,
  ])
  if(received.affectedRows!==1)throw operations.conflict()
  const ack={id:Number(row.id),refundNo:row.refund_no,status:3,fundTransactionId:fundId,amount:moneyText(amount),message:'回款已登记，凭证结果见详情'}
  await operations.complete(conn,id,Number(row.id),ack)
  return ack
}
async function receive(refundId,raw,options,readOwn) {
  const original=await lookupOwnedReceiveAck(refundId,raw,options,readOwn)
  if(original)return original
  // Only lock routing is read before BEGIN. All eligibility and identity are checked again inside.
  const [[row]]=await pool.query('SELECT purchase_order_id, purchase_return_id, refund_date FROM supplier_refund_orders WHERE id=?',[rules.safeId(refundId)])
  if(!row)throw rules.fail('退款单不存在')
  const fixed=locatorOf({purchaseOrderId:row.purchase_order_id,purchaseReturnId:row.purchase_return_id,refundDate:row.refund_date})
  const conn=await pool.getConnection()
  let ack
  try{
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await conn.beginTransaction()
    ack=await receiveInTransaction(conn,refundId,raw,{...options,locator:fixed,periodAlreadyLocked:false})
    await conn.commit()
  }catch(error){await conn.rollback();throw error}finally{conn.release()}
  await afterReceiveCommit(ack,options.postCommit)
  return ack
}
module.exports={receive,receiveInTransaction,lookupOwnedReceiveAck}
