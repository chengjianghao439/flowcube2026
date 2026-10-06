'use strict'
const {pool}=require('../../config/db')
const AppError=require('../../utils/AppError')
const {PERMISSIONS:P}=require('../../constants/permissions')
const {recordBackfillApplication}=require('../accounting/finance-period.guard')
const rules=require('./supplier-refunds.rules')
const actor=require('./supplier-refunds.actor')
const context=require('./supplier-refunds.context')
const br=require('./supplier-refunds.backfill-rules')
const operations=require('./supplier-refunds.operations')

async function transaction(readOnly,fn){
  const conn=await pool.getConnection()
  try{
    await conn.query('SET TRANSACTION ISOLATION LEVEL '+(readOnly?'REPEATABLE READ':'READ COMMITTED'))
    if(readOnly)await conn.query('START TRANSACTION READ ONLY');else await conn.beginTransaction()
    const result=await fn(conn);await conn.commit();return result
  }catch(error){await conn.rollback();throw error}finally{conn.release()}
}
function result(row){return{id:Number(row.id),applicationId:Number(row.id),applicationNo:row.application_no,backfillRequested:true,reused:true,status:Number(row.status),executed:!!row.executed_at,rejected:Number(row.status)===2,period:row.period,businessDate:rules.date(row.business_date)}}
async function find(conn,key){
  const [[row]]=await conn.query(`SELECT *,CONCAT('BF-',DATE_FORMAT(created_at,'%Y%m%d'),'-',LPAD(id,4,'0')) AS application_no FROM finance_period_backfills WHERE company_id = ? AND biz_type = ? AND request_key = ? ORDER BY id LIMIT 1`,[1,'supplier_refund',key])
  return row||null
}
async function viewFrozen(conn,data,currentActor,current=false){
  const row=await context.head(conn,data.refundId,currentActor,current),ctx=await context.context(conn,Number(row.purchase_return_id),currentActor,current)
  br.assertFrozen(data,row);await context.frozenContext(conn,row,ctx,currentActor,current)
  return row
}
async function request(refundId,body,options){
  const id=rules.safeId(refundId),reason=br.controls(options.requestKey,options.reason)
  const prepared=await transaction(false,async conn=>{
    await context.company(conn,true)
    const current=await actor.load(conn,options.userId);actor.authorize(current,P.SUPPLIER_REFUND_RECEIVE)
    if(current.roleId!==1&&!current.permissions.includes(P.FINANCE_PERIOD_BACKFILL))throw new AppError('当前账号没有跨期补录申请权限',403,'FINANCE_BACKFILL_FORBIDDEN')
    const existing=await find(conn,options.requestKey)
    if(existing){
      const data=br.parse(existing);br.assertIncoming(data,id,body,options);await viewFrozen(conn,data,current,false)
      if(existing.reason!==reason)throw br.conflict()
      if(Number(existing.status)===4)throw new AppError('原申请已作废，请核对原申请',409,'FINANCE_BACKFILL_VOIDED')
      return result(existing)
    }
    // No PO/PR/RF business lock is held while creating an application.
    const row=await context.head(conn,id,current,false),ctx=await context.context(conn,Number(row.purchase_return_id),current,false)
    await context.frozenContext(conn,row,ctx,current,false)
    if(Number(row.status)!==2)throw rules.fail('仅已确认待收退款可申请跨期补录')
    const data=br.snapshot(row,body,options),period=data.locator.refundDate.replaceAll('-','').slice(0,6)
    const [[accountingPeriod]]=await conn.query('SELECT status FROM acct_periods WHERE company_id = ? AND period = ? FOR SHARE',[1,period])
    if(Number(accountingPeriod?.status)!==2)throw new AppError('真实回款期间未结账，请沿正常回款登记',409,'SUPPLIER_REFUND_BACKFILL_NOT_CLOSED')
    return {data,period,applicantName:current.realName}
  })
  if(prepared.backfillRequested)return prepared
  // Release company/user/source preparation locks before an INSERT can wait for an application key.
  return transaction(false,async conn=>{
    const {data,period,applicantName}=prepared
    const inserted=await recordBackfillApplication(conn,{companyId:1,period,businessDate:data.locator.refundDate,bizType:'supplier_refund',bizId:id,bizNo:data.frozen.refundNo,amount:data.frozen.amount,reason,
      requestSnapshot:data,requestKey:options.requestKey,fingerprintPayload:data,applicantId:data.actorId,applicantName})
    const saved=await find(conn,options.requestKey)
    if(!saved)throw br.conflict()
    const stored=br.parse(saved);br.assertIncoming(stored,id,body,options)
    if(saved.reason!==reason||rules.stableJson(stored)!==rules.stableJson(data))throw br.conflict()
    return {...result(saved),reused:!!inserted.reused}
  })
}
async function lookupOwn(operationUuid,query,userId,expected=null){
  const uuid=rules.uuid(operationUuid),key=rules.requestKey(query.requestKey),uid=rules.safeId(userId)
  if(key.length>64||typeof query.action!=='string'||!/^supplier\.refund\.receive\.[1-9]\d*$/.test(query.action))throw br.conflict()
  return transaction(true,async conn=>{
    const current=await actor.load(conn,uid,false),row=await find(conn,key)
    if(!row)return{status:'not_found'}
    const data=br.parse(row)
    if(expected){
      br.assertIncoming(data,expected.refundId,expected.body,expected.options)
      if(expected.options.backfillRequest===true&&row.reason!==br.controls(expected.options.requestKey,expected.options.backfillReason))throw br.conflict()
    }
    if(data.actorId!==uid||data.identity.operationUuid!==uuid||data.identity.action!==query.action)throw br.conflict()
    await viewFrozen(conn,data,current,false)
    return result(row)
  })
}
async function executeInTransaction(conn,row,snapshot){
  const data=br.parse(row),posting=br.approved(row)
  if(rules.stableJson(data)!==rules.stableJson(snapshot))throw br.conflict()
  if(row.executed_at){
    // An already executed application proves its original acknowledgement only; no new period or business write gate.
    const current=await actor.load(conn,data.actorId,false)
    const head=await viewFrozen(conn,data,current,false)
    const [[op]]=await conn.query('SELECT * FROM supplier_refund_operations WHERE operation_uuid=?',[data.identity.operationUuid])
    const identity=rules.identity(data.identity.action,{...data.body,id:data.refundId},data.actorId,data.requestKey)
    operations.assertIdentity(op,identity)
    if(Number(op.status)!==1)throw operations.conflict()
    const ack=operations.response(op,head)
    const fund=await originalFund(conn,row,data,posting)
    if(Number(fund.id)!==Number(ack.fundTransactionId)||Number(fund.id)!==Number(head.fund_transaction_id))throw br.conflict()
    br.assertFund(row,head,fund,op)
    return ack
  }
  const backfill={kind:'supplier_refund',approvedId:rules.safeId(row.id),...posting}
  const ack=await require('./supplier-refunds.receive').receiveInTransaction(conn,data.refundId,data.body,{userId:data.actorId,requestKey:data.requestKey,locator:data.locator,backfill,backfillSnapshot:data})
  const [[head]]=await conn.query('SELECT * FROM supplier_refund_orders WHERE id=?',[data.refundId]);br.assertFrozen(data,head)
  const [[fund]]=await conn.query('SELECT * FROM finance_account_transactions WHERE id=?',[ack.fundTransactionId])
  if(!fund||Number(fund.backfill_id)!==Number(row.id)||rules.date(fund.voucher_date_override)!==posting.postingDate)throw br.conflict()
  return ack
}
async function originalFund(conn,row,data,posting){
  const [funds]=await conn.query('SELECT * FROM finance_account_transactions WHERE backfill_id=? ORDER BY id',[row.id])
  if(funds.length!==1)throw br.conflict()
  const fund=funds[0]
  if(Number(fund.biz_type)!==6||Number(fund.direction)!==1||Number(fund.biz_id)!==data.refundId||fund.biz_no!==data.frozen.refundNo||Number(fund.account_id)!==data.frozen.incomeAccountId||rules.positiveMoney(fund.amount)!==data.frozen.amount||rules.date(fund.happened_at)!==data.locator.refundDate||rules.date(fund.voucher_date_override)!==posting.postingDate)throw br.conflict()
  return fund
}
async function inspect(row,postingPeriod){
  try{
    return await transaction(true,async conn=>{
      const data=br.parse(row),posting=br.approved(row)
      if(!row.executed_at||row.posting_period!==postingPeriod||posting.postingPeriod!==postingPeriod)throw br.conflict()
      const fund=await originalFund(conn,row,data,posting)
      const builder=require('../accounting/voucher-supplier-refunds'),engine=require('../accounting/voucher-engine')
      const sources=await builder.loadSources(conn,{companyId:1,fundId:rules.safeId(fund.id)})
      if(sources.length!==1||sources[0].refundId!==data.refundId||sources[0].backfillId!==Number(row.id))throw br.conflict()
      const [proof]=await builder.proveSources(conn,sources,engine,1)
      return {ok:true,voucherRequired:proof.status!=='notRequired',txnCount:1,problems:[]}
    })
  }catch(error){return {ok:false,voucherRequired:true,txnCount:0,problems:[error.message]}}
}
async function settle(row){
  const data=br.parse(row),posting=br.approved(row)
  const fund=await originalFund(pool,row,data,posting)
  const result=await require('./supplier-refunds.accounting').settleReceivedVoucher({id:data.refundId,fundTransactionId:rules.safeId(fund.id),amount:data.frozen.amount,refundNo:data.frozen.refundNo},{expectedBackfill:{id:Number(row.id),...posting}})
  const error=result.status==='pending'?'供应商退款凭证待核对':result.status==='notRequired'?br.zeroMessage:null
  await pool.query(`UPDATE finance_period_backfills SET voucher_generated_at=${result.status==='pending'?'NULL':'NOW()'},voucher_generate_error=? WHERE id = ?`,[error,row.id])
  return{voucherStats:null,vouchersVerified:result.status==='pending'?0:1,voucherRequired:result.status!=='notRequired',voucherResult:result.status,voucherError:result.status==='pending'?error:null}
}
async function receiveRequest(refundId,body,options,normal){
  if(options.backfillRequest===true)br.controls(options.requestKey,options.backfillReason)
  // Exact key lookup precedes ordinary receive. A pending application cannot be bypassed by omitting controls.
  if(options.requestKey&&options.requestKey.length<=64){
    const own=await lookupOwn(body.operationUuid,{requestKey:options.requestKey,action:`supplier.refund.receive.${rules.safeId(refundId)}`},options.userId,{refundId:rules.safeId(refundId),body,options})
    if(own.status!=='not_found')return own
  }
  if(options.backfillRequest===true)return request(refundId,body,{...options,reason:options.backfillReason})
  return normal()
}
module.exports={request,lookupOwn,executeInTransaction,settle,inspect,receiveRequest}
