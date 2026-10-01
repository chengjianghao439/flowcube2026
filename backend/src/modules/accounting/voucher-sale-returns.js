'use strict'
const {decimalUnits,halfUp,centsText}=require('./voucher-sale-money')
const AppError=require('../../utils/AppError')
// Payment is locked before receipt insertion. Per-order receipt IDs therefore
// preserve actual financial execution order, including concurrent source returns.
function projectCommercialReturnVoucherAmounts(receipts){
  const cumulative=new Map(),amounts=new Map(),seen=new Set()
  for(const row of [...receipts].sort((a,b)=>Number(a.id)-Number(b.id))){
    if(seen.has(Number(row.id))||row.financial_amount==null)throw new AppError('套单退货缺少唯一实际退款证据',409,'ACCT_SALE_SOURCE_INVALID')
    seen.add(Number(row.id))
    const order=Number(row.order_id),before=cumulative.get(order)||0n,after=before+decimalUnits(row.financial_amount,4)
    const delta=halfUp(after,100n)-halfUp(before,100n)
    cumulative.set(order,after)
    const returnId=Number(row.return_id);amounts.set(returnId,(amounts.get(returnId)||0n)+delta)
  }
  return new Map([...amounts].map(([id,cents])=>[id,centsText(cents)]))
}
async function loadCommercialReturnVoucherAmounts(conn){
  const [rows]=await conn.query(`SELECT r.id,r.order_id,r.financial_amount,r.qualified_qty,sri.return_id,rti.checked_qty,rti.rejected_qty,rti.putaway_qty,rti.id AS proof_id FROM sale_commercial_refund_receipts r JOIN sale_return_items sri ON sri.id=r.return_item_id JOIN sale_returns sr ON sr.id=sri.return_id LEFT JOIN return_task_items rti ON rti.id=r.return_task_item_id AND rti.return_item_id=sri.id WHERE sr.status=3 AND sr.deleted_at IS NULL ORDER BY r.id`)
  if(rows.some(r=>r.proof_id==null||decimalUnits(r.checked_qty,2)-decimalUnits(r.rejected_qty,2)!==decimalUnits(r.qualified_qty,2)||decimalUnits(r.putaway_qty,2)!==decimalUnits(r.qualified_qty,2)))throw new AppError('套单退货凭证与真实合格入仓记录不一致',409,'ACCT_SALE_SOURCE_INVALID')
  return projectCommercialReturnVoucherAmounts(rows)
}
module.exports={projectCommercialReturnVoucherAmounts,loadCommercialReturnVoucherAmounts}
