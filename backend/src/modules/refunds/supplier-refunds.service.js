'use strict'
const {pool}=require('../../config/db')
const AppError=require('../../utils/AppError')
const {PERMISSIONS:P}=require('../../constants/permissions')
const {assertStatusAction}=require('../../constants/documentStatusRules')
const {moneyText,moneyUnits}=require('../../utils/decimalMoney')
const rules=require('./supplier-refunds.rules')
const actor=require('./supplier-refunds.actor')
const source=require('./supplier-refunds.source')
const operations=require('./supplier-refunds.operations')

async function transaction(readOnly,fn) {
  const conn=await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL '+(readOnly?'REPEATABLE READ':'READ COMMITTED'))
    if(readOnly)await conn.query('START TRANSACTION READ ONLY')
    else await conn.beginTransaction()
    const result=await fn(conn)
    await conn.commit()
    return result
  } catch(error){await conn.rollback();throw error} finally{conn.release()}
}
const {company,context,paymentContext,income,head,frozenContext}=require('./supplier-refunds.context')

async function event(conn,row,currentActor,type,operationUuid) {
  await conn.query('INSERT INTO payment_record_events (payment_record_id,order_no,event_type,title,description,payload_json,created_by,created_by_name,request_id) VALUES (?,?,?,?,?,?,?,?,?)',[
    row.payment_record_id,row.refund_no,'SUPPLIER_REFUND_'+type,'供应商退款单'+({CREATED:'已创建',CONFIRMED:'待收退款',CANCELLED:'已取消'}[type]),'本次仅更新退款意图与额度状态',rules.stableJson({refundId:Number(row.id),operationUuid}),currentActor.userId,currentActor.realName,operationUuid,
  ])
}
async function create(raw,options) {
  const body=rules.createBody(raw),id=rules.identity('supplier.refund.create',body,options.userId,options.requestKey)
  return transaction(false,async conn=>{
    await company(conn,true)
    const currentActor=await actor.load(conn,id.userId);actor.authorize(currentActor,P.SUPPLIER_REFUND_CREATE)
    const ctx=await context(conn,body.purchaseReturnId,currentActor,true)
    const replay=await operations.begin(conn,id)
    if(replay){
      const row=await head(conn,rules.safeId(replay.refund_id),currentActor,true)
      await frozenContext(conn,row,ctx,currentActor,true)
      operations.assertIdentity(replay,id)
      return operations.response(replay,row)
    }
    await income(conn,body.incomeAccountId,true,true)
    if(Number(ctx.pr.status)!==1)throw rules.fail('仅准确采购退货草稿可新建供应商退款')
    const payment=await paymentContext(conn,ctx,true,body.allocations.map(a=>a.entryId))
    const budget=await source.budget(conn,payment);source.assertBudget(payment,budget,body.amount,body.allocations)
    const snapshot=rules.stableJson(source.freeze(payment,body.allocations))
    // UUID-derived number is globally stable, with a database unique constraint as the final gate.
    const refundNo='RF'+BigInt('0x'+id.operationUuid.replace(/-/g,'')).toString(36).toUpperCase().padStart(25,'0')
    const [result]=await conn.query('INSERT INTO supplier_refund_orders (refund_no,company_id,purchase_order_id,purchase_return_id,payment_record_id,supplier_id,warehouse_id,income_account_id,refund_date,amount,status,created_by,created_operation_uuid,request_key,payload_hash,create_payload_json,source_snapshot_json,source_fingerprint,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[
      refundNo,1,ctx.po.id,ctx.pr.id,payment.ap.id,ctx.po.supplier_id,ctx.pr.warehouse_id,body.incomeAccountId,body.refundDate,body.amount,1,id.userId,id.operationUuid,id.requestKey,id.payloadHash,id.payloadJson,snapshot,rules.fingerprint(snapshot),body.remark??null,
    ])
    const refundId=rules.safeId(result.insertId)
    const values=body.allocations.map(a=>[refundId,payment.ap.id,ctx.pr.id,a.entryId,payment.proofs.find(p=>p.entryId===a.entryId).receiptId,payment.proofs.find(p=>p.entryId===a.entryId).out.id,a.amount,'draft',rules.stableJson(payment.proofs.find(p=>p.entryId===a.entryId))])
    await conn.query('INSERT INTO supplier_refund_allocations (refund_id,payment_record_id,purchase_return_id,entry_id,receipt_id,original_transaction_id,amount,budget_state,source_snapshot_json) VALUES ?',[values])
    const row={id:refundId,refund_no:refundNo,payment_record_id:payment.ap.id}
    const ack={id:refundId,refundNo,status:1}
    await event(conn,row,currentActor,'CREATED',id.operationUuid)
    await operations.complete(conn,id,refundId,ack)
    return ack
  })
}
async function change(action,refundId,raw,options) {
  const idValue=rules.safeId(refundId),body={...rules.actionBody(raw),id:idValue},id=rules.identity(`supplier.refund.${action}.${idValue}`,body,options.userId,options.requestKey)
  return transaction(false,async conn=>{
    await company(conn,true)
    const currentActor=await actor.load(conn,id.userId);actor.authorize(currentActor,action==='confirm'?P.SUPPLIER_REFUND_CONFIRM:P.SUPPLIER_REFUND_CREATE)
    // This read only locates the fixed PO/PR gates; locked head identity is checked after them.
    const [[location]]=await conn.query('SELECT purchase_return_id FROM supplier_refund_orders WHERE id=?',[idValue])
    if(!location)throw rules.fail()
    const ctx=await context(conn,rules.safeId(location.purchase_return_id),currentActor,true)
    const row=await head(conn,idValue,currentActor,true)
    const replay=await operations.begin(conn,id)
    const frozen=await frozenContext(conn,row,ctx,currentActor,true)
    if(replay){operations.assertIdentity(replay,id);return operations.response(replay,row)}
    const rule=assertStatusAction('supplierRefund',action,row.status)
    if(action==='confirm'){
      if(Number(row.created_by)===currentActor.userId && !currentActor.allowSelfApprove)throw new AppError('不允许审批自己创建的退款单',403,'SELF_APPROVAL_FORBIDDEN')
      if(Number(ctx.pr.status)!==1)throw rules.fail('采购退货已不在草稿状态，请先核对')
      // Income is already held S in frozenContext; no late account lock is introduced.
      await income(conn,Number(row.income_account_id),false,true)
      source.assertBudget(frozen.payment,await source.budget(conn,frozen.payment),row.amount,frozen.body.allocations,Number(row.id))
    }
    const [result]=await conn.query(`UPDATE supplier_refund_orders SET status=?,${action==='confirm'?'confirmed_by':'cancelled_by'}=?,${action==='confirm'?'confirmed_at':'cancelled_at'}=NOW() WHERE id=? AND status=?`,[rule.to,id.userId,idValue,Number(row.status)])
    if(result.affectedRows!==1)throw operations.conflict()
    const [allocationResult]=await conn.query('UPDATE supplier_refund_allocations SET budget_state=? WHERE refund_id=? AND budget_state=?',[action==='confirm'?'reserved':'released',idValue,Number(row.status)===1?'draft':'reserved'])
    if(allocationResult.affectedRows!==frozen.own.length)throw operations.conflict()
    const ack={id:idValue,refundNo:row.refund_no,status:rule.to}
    await event(conn,row,currentActor,action==='confirm'?'CONFIRMED':'CANCELLED',id.operationUuid)
    await operations.complete(conn,id,idValue,ack)
    return ack
  })
}
const confirm=(id,body,options)=>change('confirm',id,body,options)
const cancel=(id,body,options)=>change('cancel',id,body,options)
async function getSource(id,userId) {
  return transaction(true,async conn=>{
    const currentActor=await actor.load(conn,userId,false);actor.authorize(currentActor)
    const ctx=await context(conn,rules.safeId(id),currentActor,false)
    if(Number(ctx.pr.status)!==1)throw rules.fail('仅准确采购退货草稿可选择退款来源')
    const payment=await paymentContext(conn,ctx,false),budget=await source.budget(conn,payment,false)
    return{purchaseReturnId:Number(ctx.pr.id),returnNo:ctx.pr.return_no,purchaseOrderId:Number(ctx.po.id),orderNo:ctx.po.order_no,supplierId:Number(ctx.po.supplier_id),warehouseId:Number(ctx.pr.warehouse_id),grossAmount:moneyText(ctx.gross),availableAmount:moneyText(budget.free),paymentRecordId:Number(payment.ap.id),currentPaidAmount:moneyText(moneyUnits(payment.ap.paid_amount)),items:ctx.identity.pr.items,itemLabels:ctx.itemLabels,entries:budget.entries}
  })
}
async function getOwnOperation(uuid,query,userId,expectedIdentity=null) {
  const op=rules.uuid(uuid),key=rules.requestKey(query.requestKey)
  if(typeof query.action!=='string' || !/^(supplier\.refund\.create|supplier\.refund\.(confirm|cancel|receive)\.[1-9]\d*)$/.test(query.action))throw operations.conflict()
  return transaction(true,async conn=>{
    const currentActor=await actor.load(conn,userId,false)
    const [[row]]=await conn.query('SELECT * FROM supplier_refund_operations WHERE operation_uuid=?',[op])
    if(!row)return{status:'not_found'}
    if(Number(row.actor_id)!==currentActor.userId || row.action!==query.action || row.request_key!==key)throw operations.conflict()
    let payload;try{payload=JSON.parse(row.payload_json)}catch{throw operations.conflict()}
    const identity=rules.identity(row.action,payload,userId,key);operations.assertIdentity(row,identity)
    if(expectedIdentity)operations.assertIdentity(row,expectedIdentity)
    if(row.action!=='supplier.refund.create' && row.action!==`supplier.refund.${row.action.split('.')[2]}.${rules.safeId(payload.id)}`)throw operations.conflict()
    let refund=null,prId
    if(row.refund_id!=null){refund=await head(conn,rules.safeId(row.refund_id),currentActor,false);prId=refund.purchase_return_id}
    else if(row.action==='supplier.refund.create')prId=rules.safeId(payload.purchaseReturnId)
    else{refund=await head(conn,rules.safeId(payload.id),currentActor,false);prId=refund.purchase_return_id}
    const ctx=await context(conn,rules.safeId(prId),currentActor,false)
    if(Number(row.status)===0)return{status:'pending'}
    if(Number(row.status)!==1 || !refund)throw operations.conflict()
    await frozenContext(conn,refund,ctx,currentActor,false)
    return{status:'success',resourceType:'supplier_refund_order',resourceId:Number(refund.id),data:operations.response(row,refund)}
  })
}
// Count and page use the same read-only snapshot and identical full head warehouse gates.
function listWhere(currentActor) {
  const scope=currentActor.warehouseIds
  const terms=['rf.company_id=1','po.id=rf.purchase_order_id','pr.purchase_order_id=po.id','pr.supplier_id=po.supplier_id','rf.supplier_id=po.supplier_id','rf.warehouse_id=pr.warehouse_id','pr.warehouse_id=po.warehouse_id','rf.warehouse_id>0','po.warehouse_id>0','pr.warehouse_id>0']
  const args=[]
  if(scope!==null){if(!scope.length)terms.push('1=0');else{terms.push('rf.warehouse_id IN (?) AND po.warehouse_id IN (?) AND pr.warehouse_id IN (?)');args.push(scope,scope,scope)}}
  return{where:terms.join(' AND '),args}
}
async function findAll(query,userId) {
  const page=query.page===undefined?1:rules.safeId(query.page),pageSize=query.pageSize===undefined?20:rules.safeId(query.pageSize)
  if(pageSize>200 || !Number.isSafeInteger((page-1)*pageSize))throw new AppError('每页最多200条',400,'SUPPLIER_REFUND_INPUT_INVALID')
  return transaction(true,async conn=>{
    const currentActor=await actor.load(conn,userId,false);actor.authorize(currentActor)
    const {where,args}=listWhere(currentActor),from=' FROM supplier_refund_orders rf JOIN purchase_orders po ON po.id=rf.purchase_order_id JOIN purchase_returns pr ON pr.id=rf.purchase_return_id WHERE '+where
    const [[count]]=await conn.query('SELECT COUNT(*) AS total'+from,args)
    const [list]=await conn.query('SELECT rf.id,rf.refund_no,rf.purchase_return_id,rf.purchase_order_id,rf.warehouse_id,rf.refund_date,rf.amount,rf.status,pr.return_no AS purchase_return_no,po.order_no AS purchase_order_no,pr.supplier_name,pr.warehouse_name'+from+' ORDER BY rf.id DESC LIMIT ? OFFSET ?',[...args,pageSize,(page-1)*pageSize])
    return{list:list.map(row=>({...row,refund_date:rules.date(row.refund_date)})),total:Number(count.total),page,pageSize}
  })
}
async function findById(id,userId) {
  return transaction(true,async conn=>{
    const currentActor=await actor.load(conn,userId,false);actor.authorize(currentActor)
    const row=await head(conn,rules.safeId(id),currentActor,false)
    const ctx=await context(conn,Number(row.purchase_return_id),currentActor,false)
    await frozenContext(conn,row,ctx,currentActor,false)
    const [allocations]=await conn.query('SELECT entry_id,receipt_id,amount,budget_state FROM supplier_refund_allocations WHERE refund_id=? ORDER BY id',[row.id])
    return{...row,purchase_return_no:ctx.pr.return_no,purchase_order_no:ctx.po.order_no,supplier_name:ctx.pr.supplier_name,warehouse_name:ctx.pr.warehouse_name,refund_date:rules.date(row.refund_date),allocations,confirmAllowed:Number(row.status)===1 && (currentActor.roleId===1 || currentActor.permissions.includes(P.SUPPLIER_REFUND_CONFIRM)) && (Number(row.created_by)!==currentActor.userId || currentActor.allowSelfApprove)}
  })
}
async function receive(id,body,options){
  return require('./supplier-refunds.backfill').receiveRequest(id,body,options,()=>require('./supplier-refunds.receive').receive(id,body,options,getOwnOperation))
}
async function lookupBackfillApplication(uuid,query,userId){return require('./supplier-refunds.backfill').lookupOwn(uuid,query,userId)}
async function regenerateVoucher(id,userId){return require('./supplier-refunds.accounting').regenerate(id,userId)}
module.exports={create,confirm,cancel,receive,lookupBackfillApplication,regenerateVoucher,getSource,getOwnOperation,findAll,findById}
