'use strict'
// Finite supplier-refund application identity. No database or request objects.
const AppError=require('../../utils/AppError')
const rules=require('./supplier-refunds.rules')
const conflict=()=>new AppError('原供应商退款补录身份或原依据已变化，请核对原申请',409,'SUPPLIER_REFUND_BACKFILL_IDENTITY_CHANGED')
const zeroMessage='零分投影已核对/无需分位凭证'
function controls(key,reason) {
  rules.requestKey(key)
  if(key.length>64)throw new AppError('跨期补录请保留不超过64字符的原请求键',400,'SUPPLIER_REFUND_BACKFILL_INPUT_INVALID')
  if(typeof reason!=='string'||reason.trim().length<4||reason.trim().length>300)throw new AppError('请填写4至300字的补录原因',400,'SUPPLIER_REFUND_BACKFILL_INPUT_INVALID')
  return reason.trim()
}
function approved(row) {
  try{
    const postingDate=rules.date(row.approved_date)
    if(!row.approved_at||Number(row.status)!==1||!Number.isSafeInteger(Number(row.approver_id))||Number(row.approver_id)<=0||Number(row.approver_id)===Number(row.applicant_id))throw conflict()
    return {postingDate,postingPeriod:postingDate.replaceAll('-','').slice(0,6)}
  }catch{throw conflict()}
}
function frozen(row) {
  return {refundId:rules.safeId(row.id),refundNo:row.refund_no,companyId:1,purchaseOrderId:rules.safeId(row.purchase_order_id),purchaseReturnId:rules.safeId(row.purchase_return_id),
    paymentRecordId:rules.safeId(row.payment_record_id),supplierId:rules.safeId(row.supplier_id),warehouseId:rules.safeId(row.warehouse_id),incomeAccountId:rules.safeId(row.income_account_id),
    refundDate:rules.date(row.refund_date),amount:rules.positiveMoney(row.amount),createdBy:rules.safeId(row.created_by),createdOperationUuid:rules.uuid(row.created_operation_uuid),
    createRequestKey:row.request_key,createPayloadHash:row.payload_hash,createPayloadJson:row.create_payload_json,sourceFingerprint:row.source_fingerprint,sourceSnapshotJson:row.source_snapshot_json}
}
function snapshot(row,body,options) {
  const refundId=rules.safeId(row.id),actionBody=rules.actionBody(body),identity=rules.identity(`supplier.refund.receive.${refundId}`,{...actionBody,id:refundId},options.userId,options.requestKey)
  return {version:1,kind:'supplier_refund',refundId,actorId:identity.userId,requestKey:identity.requestKey,body:actionBody,
    identity:{operationUuid:identity.operationUuid,action:identity.action,payloadJson:identity.payloadJson,payloadHash:identity.payloadHash},
    locator:{purchaseOrderId:rules.safeId(row.purchase_order_id),purchaseReturnId:rules.safeId(row.purchase_return_id),refundDate:rules.date(row.refund_date)},frozen:frozen(row)}
}
function parse(row) {
  try{
    const data=typeof row.request_snapshot==='string'?JSON.parse(row.request_snapshot):row.request_snapshot
    if(!data||data.version!==1||data.kind!=='supplier_refund'||Object.keys(data).sort().join(',')!=='actorId,body,frozen,identity,kind,locator,refundId,requestKey,version')throw conflict()
    const id=rules.identity(`supplier.refund.receive.${rules.safeId(data.refundId)}`,{...rules.actionBody(data.body),id:data.refundId},data.actorId,data.requestKey)
    const expected={operationUuid:id.operationUuid,action:id.action,payloadJson:id.payloadJson,payloadHash:id.payloadHash}
    if(rules.stableJson(expected)!==rules.stableJson(data.identity)||Number(row.applicant_id)!==id.userId||Number(row.company_id)!==1||row.biz_type!=='supplier_refund'
      ||Number(row.biz_id)!==data.refundId||row.biz_no!==data.frozen.refundNo||row.request_key!==id.requestKey||rules.date(row.business_date)!==data.frozen.refundDate
      ||row.period!==data.frozen.refundDate.replaceAll('-','').slice(0,6)||rules.positiveMoney(row.amount)!==data.frozen.amount)throw conflict()
    controls(row.request_key,row.reason)
    const fingerprint=rules.fingerprint(rules.stableJson({bizType:'supplier_refund',bizId:data.refundId,payload:data})).slice(0,16)
    if(row.payload_fingerprint!==fingerprint||rules.stableJson(data.locator)!==rules.stableJson({purchaseOrderId:data.frozen.purchaseOrderId,purchaseReturnId:data.frozen.purchaseReturnId,refundDate:data.frozen.refundDate}))throw conflict()
    return data
  }catch(error){if(error.code==='SUPPLIER_REFUND_BACKFILL_IDENTITY_CHANGED')throw error;throw conflict()}
}
function assertFrozen(data,row) {if(rules.stableJson(frozen(row))!==rules.stableJson(data.frozen))throw conflict()}
function assertIncoming(data,refundId,body,options) {
  const id=rules.identity(`supplier.refund.receive.${rules.safeId(refundId)}`,{...rules.actionBody(body),id:rules.safeId(refundId)},options.userId,options.requestKey)
  if(data.refundId!==refundId||data.actorId!==id.userId||data.requestKey!==id.requestKey||data.identity.payloadJson!==id.payloadJson||data.identity.payloadHash!==id.payloadHash||data.identity.operationUuid!==id.operationUuid)throw conflict()
}
function assertFund(row,refund,fund,receiveOperation) {
  const data=parse(row),posting=approved(row)
  assertFrozen(data,refund)
  if(!row.executed_at||Number(row.executed_biz_id)!==data.refundId||row.posting_period!==posting.postingPeriod||Number(fund.backfill_id)!==Number(row.id)
    ||rules.date(fund.voucher_date_override)!==posting.postingDate||rules.date(fund.happened_at)!==data.locator.refundDate
    ||Number(receiveOperation.actor_id)!==data.actorId||receiveOperation.request_key!==data.requestKey||receiveOperation.payload_json!==data.identity.payloadJson
    ||receiveOperation.payload_hash!==data.identity.payloadHash||receiveOperation.operation_uuid!==data.identity.operationUuid)throw conflict()
}
module.exports={controls,approved,snapshot,parse,assertFrozen,assertIncoming,assertFund,conflict,zeroMessage}
