'use strict'
// Called only after the actual business commit. Generates exactly one received RF source.
const {pool}=require('../../config/db')
const AppError=require('../../utils/AppError')
const {PERMISSIONS:P}=require('../../constants/permissions')
const engine=require('../accounting/voucher-engine')
const builder=require('../accounting/voucher-supplier-refunds')
const {lockAccountingCompany}=require('../accounting/accounting.period-lock')
const rules=require('./supplier-refunds.rules')
const actor=require('./supplier-refunds.actor')
async function saveResult(conn,id,result) {
  const error=result.status==='notRequired'?'零分投影已核对/无需凭证':null
  const voucherId=result.status==='generated'?rules.safeId(result.voucherId):null
  const [row]=await conn.query('UPDATE supplier_refund_orders SET voucher_id=?,voucher_generate_error=? WHERE id=? AND status=3',[voucherId,error,id])
  if(row.affectedRows!==1)throw new AppError('凭证结果未保存，请重试核对',409,'SUPPLIER_REFUND_VOUCHER_SAVE_FAILED')
}
async function settleReceivedVoucher(ack,{manualUserId=null,expectedBackfill=null}={}) {
  const id=rules.safeId(ack.id)
  let fund=manualUserId==null?rules.safeId(ack.fundTransactionId):null,authorized=manualUserId==null
  const conn=await pool.getConnection()
  try{
    await conn.beginTransaction()
    await lockAccountingCompany(conn,1)
    if(manualUserId!=null){
      const current=await actor.load(conn,manualUserId,true)
      actor.authorize(current,P.ACCOUNTING_VOUCHER_MANAGE)
      const [[row]]=await conn.query('SELECT * FROM supplier_refund_orders WHERE id=?',[id])
      if(!row)throw rules.fail('退款单不存在')
      actor.assertScope(current,row.warehouse_id)
      if(Number(row.company_id)!==1||Number(row.status)!==3)throw rules.fail('只有已收到退款可以核对凭证')
      fund=rules.safeId(row.fund_transaction_id)
      ack={id,fundTransactionId:fund,amount:rules.positiveMoney(row.amount),refundNo:row.refund_no}
      authorized=true
    }
    const sources=await builder.loadSources(conn,{companyId:1,fundId:fund})
    if(sources.length!==1||sources[0].refundId!==id||sources[0].amount4!==ack.amount||sources[0].spec.sourceNo!==ack.refundNo)throw new AppError('原回款来源与记录不符',409,'ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
    const source=sources[0]
    if(expectedBackfill&&(source.backfillId!==rules.safeId(expectedBackfill.id)||source.spec.voucherDate!==rules.date(expectedBackfill.postingDate)||source.spec.voucherDate.replaceAll('-','').slice(0,6)!==expectedBackfill.postingPeriod))throw new AppError('原补录流水与批准日期不符',409,'ACCT_SUPPLIER_REFUND_SOURCE_INVALID')
    let proof
    try{[proof]=await builder.proveSources(conn,sources,engine,1)}catch(error){
      if(error.code!=='ACCT_SUPPLIER_REFUND_VOUCHER_REQUIRED'||source.notRequired)throw error
      const map=await engine.loadAccountMap(conn,1),seq=await engine.makeSeqAllocator(conn,1)
      await engine.upsertVoucher(conn,source.spec,map,seq,null,1)
      ;[proof]=await builder.proveSources(conn,sources,engine,1)
    }
    const result={status:proof.status,...(proof.voucherId?{voucherId:proof.voucherId}:{})}
    await saveResult(conn,id,result)
    await conn.commit()
    return result
  }catch(error){
    await conn.rollback()
    if(!authorized)throw error
    // Saving this error can fail too. Existing pending business result remains authoritative.
    try{
      await conn.beginTransaction();await lockAccountingCompany(conn,1)
      if(manualUserId!=null){
        const current=await actor.load(conn,manualUserId,true)
        actor.authorize(current,P.ACCOUNTING_VOUCHER_MANAGE)
        const [[row]]=await conn.query('SELECT * FROM supplier_refund_orders WHERE id=?',[id])
        if(!row||Number(row.company_id)!==1||Number(row.status)!==3)throw rules.fail()
        actor.assertScope(current,row.warehouse_id)
      }
      const message=[...String(error.message||'凭证待核对')].slice(0,500).join('')
      const [saved]=await conn.query('UPDATE supplier_refund_orders SET voucher_id=?,voucher_generate_error=? WHERE id=? AND status=3',[null,message,id])
      if(saved.affectedRows!==1)throw error
      await conn.commit()
    }catch{await conn.rollback()}
    return{status:'pending'}
  }finally{conn.release()}
}
async function regenerate(id,userId) {
  return settleReceivedVoucher({id:rules.safeId(id)},{manualUserId:rules.safeId(userId)})
}
module.exports={settleReceivedVoucher,regenerate}
