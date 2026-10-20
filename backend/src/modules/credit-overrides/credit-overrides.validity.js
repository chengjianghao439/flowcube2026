const AppError = require('../../utils/AppError')
const policy = require('./credit-overrides.policy')
const { getNetOrderAmount } = require('../sale/sale.contracts')
const { getCustomerCreditUsedForOrders } = require('../../utils/creditExposure')

// Supersession is an append-only fact: even a cancelled/rejected/deleted newer
// request must not resurrect an older approval. Original documents/engine/audit
// rows and proof bytes are never rewritten by validity evaluation or reapply.
const APPROVAL_SELECT = `SELECT c.*,p.sale_order_id AS proof_order_id,p.basis_hash,p.expires_at,
  (p.expires_at IS NOT NULL AND p.expires_at<=NOW()) AS proof_expired,
  EXISTS(SELECT 1 FROM approval_instances i WHERE i.biz_type='sale_credit_override' AND i.biz_id=c.id AND i.status=2) AS approval_completed,
  (SELECT MAX(n.id) FROM sale_credit_overrides n WHERE n.sale_order_id=c.sale_order_id AND n.id>c.id) AS superseded_by
  FROM sale_credit_overrides c LEFT JOIN sale_credit_approval_proofs p ON p.override_id=c.id`

const reasons = {
  SUPERSEDED: '已有更新的申请，原批准不再用于放行',
  MISSING_PROOF: '缺少原始内容证明',
  EXPIRED: '已超过有效截止时间',
  ORDER_UNAVAILABLE: '销售单已结束或不存在',
  CUSTOMER_CHANGED: '销售单客户已变更',
  CONTENT_CHANGED: '销售单内容已变更',
  CREDIT_LIMIT_CHANGED: '客户授信额度已变更',
  AMOUNT_CHANGED: '销售单金额已变更',
  EXPOSURE_EXCEEDED: '当前超额金额已超过原批准范围',
  APPROVAL_UNCONFIRMED: '缺少已完成的审批记录',
}
const allowed = o => o && !o.deleted_at && [1,2,3,6].includes(Number(o.status))
function evaluate(row, current) {
  const o = current?.order
  let reasonCode = null
  if (row.superseded_by) reasonCode = 'SUPERSEDED'
  else if (!row.basis_hash || Number(row.proof_order_id)!==Number(row.sale_order_id)) reasonCode = 'MISSING_PROOF'
  else if (Number(row.proof_expired)===1) reasonCode = 'EXPIRED'
  else if (!allowed(o) || Number(o.id)!==Number(row.sale_order_id)) reasonCode = 'ORDER_UNAVAILABLE'
  else if (Number(row.customer_id)!==Number(current.customerId)) reasonCode = 'CUSTOMER_CHANGED'
  else if (row.basis_hash!==current.basisHash) reasonCode = 'CONTENT_CHANGED'
  else if (current.creditLimit==null || Math.abs(Number(row.credit_limit)-Number(current.creditLimit))>0.005) reasonCode = 'CREDIT_LIMIT_CHANGED'
  else if (Math.abs(Number(row.this_amount)-Number(current.thisAmount))>0.005) reasonCode = 'AMOUNT_CHANGED'
  else if (Number(current.overAmount)>Number(row.over_amount)+0.005) reasonCode = 'EXPOSURE_EXCEEDED'
  else if (!Number(row.approval_completed)) reasonCode = 'APPROVAL_UNCONFIRMED'
  const canReapply = !!reasonCode && reasonCode!=='SUPERSEDED' && allowed(o) && current.creditLimit!=null && Number(current.overAmount)>0
  return { valid:!reasonCode,reasonCode,canReapply,message:reasonCode ? `原批准已失效：${reasons[reasonCode]}。` : null }
}

function invalidError(row, result) {
  const next = result.reasonCode==='SUPERSEDED' ? '请查看最新申请进度；已结束时可重新申请。' : '请按当前销售单重新申请审批，无需先取消历史批准。'
  return new AppError(result.message+next,409,'CREDIT_APPROVAL_INVALID',{approvalId:Number(row.id),overrideNo:row.override_no,reasonCode:result.reasonCode,canReapply:result.canReapply})
}

async function activeForOrder(db, id) {
  const [rows] = await db.query(`${APPROVAL_SELECT} WHERE c.sale_order_id=? AND c.status IN (1,2,3) AND c.deleted_at IS NULL ORDER BY c.id DESC FOR UPDATE`,[Number(id)])
  // NOW in the locking query was sampled before any proof-lock wait. Evaluate
  // again only after those locks are held, using the same database clock.
  if (rows.length) {
    const [proofs] = await db.query('SELECT override_id,(expires_at IS NOT NULL AND expires_at<=NOW()) AS proof_expired FROM sale_credit_approval_proofs WHERE override_id IN (?) FOR SHARE',[rows.map(r=>r.id)])
    const expired = new Map(proofs.map(p=>[Number(p.override_id),p.proof_expired]))
    for (const r of rows) r.proof_expired = expired.get(Number(r.id)) ?? 0
  }
  return rows
}
const inactivePending = row => Number(row.status)===2 && (!!row.superseded_by || Number(row.proof_expired)===1)
async function latestApproved(db, id) {
  const [[row]] = await db.query(`${APPROVAL_SELECT} WHERE c.sale_order_id=? AND c.status=3 AND c.deleted_at IS NULL ORDER BY c.id DESC LIMIT 1 FOR SHARE`,[Number(id)])
  return row || null
}

async function decorate(db, rows) {
  const ids = rows.filter(r=>[2,3].includes(r.status)).map(r=>r.id)
  if (!ids.length) return rows
  const [meta] = await db.query(`${APPROVAL_SELECT} WHERE c.id IN (?)`,[ids])
  const orderIds = [...new Set(meta.map(r=>Number(r.sale_order_id)))]
  const [orders] = await db.query(`SELECT so.*,c.credit_limit AS current_credit_limit FROM sale_orders so
    LEFT JOIN sale_customers c ON c.id=so.customer_id AND c.deleted_at IS NULL WHERE so.id IN (?)`,[orderIds])
  const [items] = await db.query('SELECT order_id,id,product_id,warehouse_id,unit,quantity,unit_price FROM sale_order_items WHERE order_id IN (?) ORDER BY order_id,id',[orderIds])
  const used = await getCustomerCreditUsedForOrders(db,orders)
  const byOrder = new Map(orders.map(o=>[Number(o.id),o])), byItems = new Map()
  for (const i of items) { const key=Number(i.order_id);if(!byItems.has(key))byItems.set(key,[]);byItems.get(key).push(i) }
  const byId = new Map(meta.map(r=>[Number(r.id),r]))
  return rows.map(row=>{
    if(![2,3].includes(row.status))return row
    const r=byId.get(row.id), order=byOrder.get(Number(r?.sale_order_id)), lines=byItems.get(Number(order?.id)) || []
    if(!r)return row
    const amount=order?getNetOrderAmount(order.total_amount,order.discount_amount):0
    const limit=order?.current_credit_limit
    const overAmount=Math.max(0,Math.round(((used.get(Number(order?.id)) || 0)+amount-Number(limit || 0))*100)/100)
    const shared={supersededBy:r.superseded_by?Number(r.superseded_by):null,expiresAt:r.expires_at,
      currentOrderAmount:order?amount:null,currentCustomerName:order?.customer_name || null,currentOrderStatus:order?Number(order.status):null}
    if(row.status===2){
      const expired=Number(r.proof_expired)===1, superseded=!!r.superseded_by
      const inactive=expired || superseded
      return {...row,...shared,statusName:expired?'已过期':superseded?'已被新申请替代':row.statusName,
        requestValidity:expired?'expired':superseded?'superseded':'pending',
        requestInvalidReason:expired?`待审批申请已过期：已超过有效截止时间。${superseded?'已有更新的申请，请查看新申请进度。':'请按当前销售单重新申请，无需先取消历史申请。'}`:superseded?'已有更新的申请，原申请仅保留审批历史，不能继续审批。':null,
        canReapply:expired&&!superseded&&allowed(order)&&limit!=null&&overAmount>0,
        ...(inactive?{canApprove:false,currentTaskId:null}:{})}
    }
    const state=evaluate(r,{order,customerId:order?.customer_id,creditLimit:limit,thisAmount:amount,
      overAmount,
      basisHash:order && lines.length?policy.hashOrderBasis(order,lines):null})
    return {...row,statusName:state.valid?row.statusName:'已批准（已失效）',approvalValidity:state.valid?'valid':'invalid',
      approvalInvalidReasonCode:state.reasonCode,approvalInvalidReason:state.message,canReapply:state.canReapply,
      ...shared}
  })
}
module.exports = { evaluate,invalidError,activeForOrder,inactivePending,latestApproved,decorate }
