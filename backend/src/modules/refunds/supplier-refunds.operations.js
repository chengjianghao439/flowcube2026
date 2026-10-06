'use strict'
const AppError=require('../../utils/AppError')
const rules=require('./supplier-refunds.rules')
const conflict=()=>new AppError('原退款操作身份或载荷已变化，请保留原请求核对',409,'SUPPLIER_REFUND_OPERATION_CONFLICT')
function assertIdentity(row,id) {
  if(!row || row.operation_uuid!==id.operationUuid || row.action!==id.action || Number(row.actor_id)!==id.userId || row.request_key!==id.requestKey || row.payload_json!==id.payloadJson || row.payload_hash!==id.payloadHash || rules.fingerprint(row.payload_json)!==row.payload_hash) throw conflict()
}
async function begin(conn,id) {
  try {
    await conn.query('INSERT INTO supplier_refund_operations (operation_uuid,action,actor_id,request_key,payload_hash,payload_json,status) VALUES (?,?,?,?,?,?,0)',[id.operationUuid,id.action,id.userId,id.requestKey,id.payloadHash,id.payloadJson])
    return null
  } catch(e) {
    if(e.code!=='ER_DUP_ENTRY')throw e
    const [[row]]=await conn.query('SELECT * FROM supplier_refund_operations WHERE operation_uuid=? FOR SHARE',[id.operationUuid])
    assertIdentity(row,id)
    if(Number(row.status)!==1)throw new AppError('原退款操作仍待确认，请只核对原结果',409,'SUPPLIER_REFUND_OPERATION_PENDING')
    return row
  }
}
async function complete(conn,id,refund,data) {
  const [result]=await conn.query('UPDATE supplier_refund_operations SET refund_id=?,resource_type=?,resource_id=?,response_json=?,status=1,completed_at=NOW() WHERE operation_uuid=? AND status=0',[refund,'supplier_refund_order',refund,rules.stableJson(data),id.operationUuid])
  if(result.affectedRows!==1)throw conflict()
}
function response(row,head) {
  if(row.resource_type!=='supplier_refund_order' || Number(row.refund_id)!==Number(head.id) || Number(row.resource_id)!==Number(head.id))throw conflict()
  let data,payload
  try{data=JSON.parse(row.response_json);payload=JSON.parse(row.payload_json)}catch{throw conflict()}
  if(rules.stableJson(data)!==row.response_json || rules.stableJson(payload)!==row.payload_json || rules.fingerprint(row.payload_json)!==row.payload_hash || payload.operationUuid!==row.operation_uuid)throw conflict()
  const status=row.action==='supplier.refund.create'?1:row.action===`supplier.refund.confirm.${head.id}`?2:row.action===`supplier.refund.cancel.${head.id}`?4:row.action===`supplier.refund.receive.${head.id}`?3:null
  const expected=status===3?{id:Number(head.id),refundNo:head.refund_no,status:3,fundTransactionId:rules.safeId(head.fund_transaction_id),amount:rules.positiveMoney(head.amount),message:'回款已登记，凭证结果见详情'}:{id:Number(head.id),refundNo:head.refund_no,status}
  if(!status || rules.stableJson(data)!==rules.stableJson(expected) || (status===1 ? payload.purchaseReturnId!==Number(head.purchase_return_id) : payload.id!==Number(head.id)))throw conflict()
  return data
}
module.exports={begin,complete,assertIdentity,response,conflict}
