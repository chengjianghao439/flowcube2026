'use strict'
const AppError=require('../../utils/AppError')
async function assertNoPendingRefund(conn,purchaseReturnId) {
  // Caller holds the shared PO and exclusive PR gates. This is the first ordinary read
  // after those current reads, so RR sees the committed allocations guarded by this PR.
  // Do not lock peer refunds or allocations before the common AP budget gate.
  const [rows]=await conn.query('SELECT budget_state FROM supplier_refund_allocations WHERE purchase_return_id=? ORDER BY id',[purchaseReturnId])
  if(rows.some(row=>row.budget_state==='reserved'))throw new AppError('有已确认待收的供应商退款，请先收到或取消退款后再处理退货',409,'SUPPLIER_REFUND_PENDING')
  return{received:rows.some(row=>row.budget_state==='received')}
}
module.exports={assertNoPendingRefund}
