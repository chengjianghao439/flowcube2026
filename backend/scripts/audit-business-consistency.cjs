'use strict'
// 生产可用的只读检查；完整异常计数、有界样本，任何 SQL 失败显式记为 error。
const path = require('node:path')
const tables = ['sale_orders', 'sale_order_items', 'warehouse_tasks', 'warehouse_task_items',
  'purchase_orders', 'purchase_order_items', 'inbound_tasks', 'inbound_task_items',
  'payment_records', 'payment_entries', 'payment_receipts', 'reconciliation_statements',
  'sale_returns', 'purchase_returns', 'return_tasks', 'refund_orders', 'fin_invoices',
  'acct_vouchers', 'acct_voucher_entries', 'finance_accounts', 'finance_account_transactions',
  'inventory_containers', 'inventory_stock', 'stock_reservations', 'transfer_orders',
  'inventory_checks', 'inventory_disposal_orders', 'expense_claims', 'hr_payrolls', 'fixed_assets']
const checks = []
const add = (id, sql, interpretation = 'mismatch') => checks.push({ id, sql, interpretation })

for (const type of ['sale', 'purchase']) {
  add(`${type}_header_items`, `SELECT o.id,o.order_no,o.total_amount,COALESCE(i.amount,0) item_amount
    FROM ${type}_orders o LEFT JOIN (SELECT order_id,SUM(amount) amount FROM ${type}_order_items GROUP BY order_id)i ON i.order_id=o.id
    WHERE o.deleted_at IS NULL AND ABS(o.total_amount-COALESCE(i.amount,0))>0.01`)
  add(`${type}_line_amount`, `SELECT id,order_id,quantity,unit_price,amount FROM ${type}_order_items WHERE ABS(amount-quantity*unit_price)>0.01`)
  add(`${type}_line_orphan`, `SELECT i.id,i.order_id FROM ${type}_order_items i LEFT JOIN ${type}_orders o ON o.id=i.order_id WHERE o.id IS NULL`)
}
add('payment_source_identity', `SELECT p.id,p.type,p.order_id,p.order_no,
  CASE WHEN p.type=2 THEN s.order_no ELSE b.order_no END source_no
  FROM payment_records p LEFT JOIN sale_orders s ON p.type=2 AND s.id=p.order_id
  LEFT JOIN purchase_orders b ON p.type=1 AND b.id=p.order_id WHERE p.order_id IS NOT NULL
  AND (CASE WHEN p.type=2 THEN s.id ELSE b.id END IS NULL OR p.order_no<>CASE WHEN p.type=2 THEN s.order_no ELSE b.order_no END)`)
add('payment_arithmetic', `SELECT id,type,total_amount,paid_amount,balance,status FROM payment_records
  WHERE ABS(balance-GREATEST(0,total_amount-paid_amount))>0.0001 OR total_amount<0 OR paid_amount<0
  OR status<>CASE WHEN paid_amount>=total_amount THEN 3 WHEN paid_amount>0 THEN 2 ELSE 1 END`)
add('payment_entries_total', `SELECT p.id,p.paid_amount,COALESCE(e.amount,0) entry_amount FROM payment_records p
  LEFT JOIN (SELECT record_id,SUM(amount) amount FROM payment_entries GROUP BY record_id)e ON e.record_id=p.id
  WHERE ABS(p.paid_amount-COALESCE(e.amount,0))>0.0001`)
add('payment_entry_orphan', `SELECT e.id,e.record_id FROM payment_entries e LEFT JOIN payment_records p ON p.id=e.record_id WHERE p.id IS NULL`)
add('sale_shipping_projection', `SELECT i.order_id,i.product_id,i.warehouse_id,i.shipped_qty,COALESCE(t.shipped_qty,0) task_shipped_qty
  FROM (SELECT order_id,product_id,warehouse_id,SUM(shipped_qty) shipped_qty FROM sale_order_items GROUP BY order_id,product_id,warehouse_id)i
  LEFT JOIN (SELECT w.sale_order_id,w.warehouse_id,x.product_id,SUM(x.picked_qty) shipped_qty
    FROM warehouse_tasks w JOIN warehouse_task_items x ON x.task_id=w.id
    WHERE w.task_type='sale_out' AND w.status=7 AND w.deleted_at IS NULL GROUP BY w.sale_order_id,w.warehouse_id,x.product_id)t
    ON t.sale_order_id=i.order_id AND t.warehouse_id=i.warehouse_id AND t.product_id=i.product_id
  WHERE ABS(i.shipped_qty-COALESCE(t.shipped_qty,0))>0.0001`)
add('shipped_task_source', `SELECT w.id,w.task_no,w.sale_order_id,x.product_id FROM warehouse_tasks w
  JOIN warehouse_task_items x ON x.task_id=w.id LEFT JOIN sale_order_items i
  ON i.order_id=w.sale_order_id AND i.warehouse_id=w.warehouse_id AND i.product_id=x.product_id
  WHERE w.task_type='sale_out' AND w.status=7 AND w.deleted_at IS NULL AND i.id IS NULL`)
add('sale_receivable_projection', `SELECT x.* FROM (SELECT o.id,o.order_no,p.id payment_id,p.total_amount recorded_amount,
  GREATEST(0,COALESCE(i.gross,0)-CASE WHEN o.total_amount>0 THEN LEAST(1,COALESCE(i.gross,0)/o.total_amount)*o.discount_amount ELSE 0 END-COALESCE(r.amount,0)) expected_amount
  FROM sale_orders o LEFT JOIN (SELECT order_id,SUM(shipped_qty*unit_price) gross FROM sale_order_items GROUP BY order_id)i ON i.order_id=o.id
  LEFT JOIN (SELECT s.sale_order_id,SUM((ti.checked_qty-ti.rejected_qty)*si.unit_price) amount FROM sale_returns s
    JOIN return_tasks t ON t.return_id=s.id AND t.return_type='sale' AND t.deleted_at IS NULL
    JOIN return_task_items ti ON ti.task_id=t.id JOIN sale_return_items si ON si.id=ti.return_item_id
    WHERE s.status=3 AND s.deleted_at IS NULL GROUP BY s.sale_order_id)r ON r.sale_order_id=o.id
  LEFT JOIN payment_records p ON p.type=2 AND p.order_id=o.id)x
  WHERE ABS(COALESCE(recorded_amount,0)-expected_amount)>0.01`, 'review_source_completeness')
add('purchase_payable_projection', `SELECT x.* FROM (SELECT o.id,o.order_no,p.id payment_id,p.total_amount recorded_amount,
  GREATEST(0,COALESCE(i.gross,0)-COALESCE(r.amount,0)) expected_amount FROM purchase_orders o
  LEFT JOIN (SELECT ti.purchase_order_id,SUM(ti.putaway_qty*pi.unit_price) gross FROM inbound_tasks t
    JOIN inbound_task_items ti ON ti.task_id=t.id JOIN purchase_order_items pi ON pi.id=ti.purchase_item_id
    WHERE t.deleted_at IS NULL AND t.status<>5 AND t.audit_status=1 GROUP BY ti.purchase_order_id)i ON i.purchase_order_id=o.id
  LEFT JOIN (SELECT purchase_order_id,SUM(total_amount) amount FROM purchase_returns WHERE status=3 AND deleted_at IS NULL GROUP BY purchase_order_id)r ON r.purchase_order_id=o.id
  LEFT JOIN payment_records p ON p.type=1 AND p.order_id=o.id)x
  WHERE ABS(COALESCE(recorded_amount,0)-expected_amount)>0.01`, 'review_source_completeness')
add('inbound_purchase_link', `SELECT t.id,t.task_no,i.id item_id,t.purchase_order_id header_purchase_id,i.purchase_order_id,i.purchase_item_id
  FROM inbound_tasks t JOIN inbound_task_items i ON i.task_id=t.id LEFT JOIN purchase_order_items p ON p.id=i.purchase_item_id
  WHERE t.deleted_at IS NULL AND (i.purchase_order_id IS NULL OR i.purchase_item_id IS NULL OR p.id IS NULL OR p.order_id<>i.purchase_order_id OR p.product_id<>i.product_id)`)
add('inbound_completed_projection', `SELECT t.id,t.task_no,t.status,t.audit_status,i.id item_id,i.received_qty,i.putaway_qty
  FROM inbound_tasks t JOIN inbound_task_items i ON i.task_id=t.id WHERE t.deleted_at IS NULL AND t.status=4
  AND (t.audit_status<>1 OR ABS(i.received_qty-i.putaway_qty)>0.0001)`, 'review_legacy_completion')
add('inbound_terminal_purchase', `SELECT t.id,t.task_no,o.id purchase_id,o.order_no,o.status purchase_status,i.received_qty,i.putaway_qty
  FROM inbound_tasks t JOIN inbound_task_items i ON i.task_id=t.id
  JOIN purchase_orders o ON o.id=COALESCE(i.purchase_order_id,t.purchase_order_id)
  WHERE t.deleted_at IS NULL AND t.status IN (1,2,3) AND (o.status IN (3,4) OR o.deleted_at IS NOT NULL)`, 'review_receiving_state')
add('legacy_purchase_receiving_overlap', `SELECT t.id,t.task_no,o.id purchase_id,o.order_no,c.id legacy_container_id,c.barcode,
  c.initial_qty legacy_qty,i.received_qty,i.putaway_qty FROM inbound_tasks t JOIN inbound_task_items i ON i.task_id=t.id
  JOIN purchase_orders o ON o.id=COALESCE(i.purchase_order_id,t.purchase_order_id)
  JOIN inventory_containers c ON c.source_ref_type='purchase_order' AND c.source_ref_id=o.id
    AND c.product_id=i.product_id AND c.warehouse_id=t.warehouse_id AND c.deleted_at IS NULL
  WHERE t.deleted_at IS NULL AND t.status IN (2,3) AND i.received_qty>i.putaway_qty`, 'review_possible_duplicate_receipt')
add('inbound_quantities', `SELECT id,task_id,received_qty,putaway_qty FROM inbound_task_items WHERE received_qty<0 OR putaway_qty<0 OR putaway_qty>received_qty+0.0001`)
for (const kind of ['sale', 'purchase']) add(`${kind}_return_source`, `SELECT r.id,r.return_no,r.${kind}_order_id source_id,r.${kind}_order_no source_no
  FROM ${kind}_returns r LEFT JOIN ${kind}_orders o ON o.id=r.${kind}_order_id
  WHERE r.deleted_at IS NULL AND r.${kind}_order_id IS NOT NULL AND (o.id IS NULL OR o.order_no<>r.${kind}_order_no)`)
add('return_quantities', `SELECT id,task_id,received_qty,checked_qty,rejected_qty,putaway_qty FROM return_task_items
  WHERE received_qty<0 OR checked_qty<0 OR rejected_qty<0 OR putaway_qty<0 OR checked_qty>received_qty+0.0001
    OR rejected_qty>checked_qty+0.0001 OR putaway_qty>checked_qty-rejected_qty+0.0001`)
add('refund_source', `SELECT r.id,r.payment_record_id FROM refund_orders r LEFT JOIN payment_records p ON p.id=r.payment_record_id
  WHERE r.payment_record_id IS NOT NULL AND p.id IS NULL`)
add('receipt_arithmetic', `SELECT id,receipt_no,amount,settled_amount,balance FROM payment_receipts
  WHERE deleted_at IS NULL AND ABS(balance-(amount-settled_amount))>0.0001`)
add('statement_projection', `SELECT s.id,s.statement_no,s.total_amount,s.settled_amount,s.balance,COALESCE(i.amount,0) source_amount,COALESCE(i.paid,0) source_paid
  FROM reconciliation_statements s LEFT JOIN (SELECT x.statement_id,SUM(p.total_amount) amount,SUM(p.paid_amount) paid
    FROM reconciliation_statement_items x JOIN payment_records p ON p.id=x.record_id GROUP BY x.statement_id)i ON i.statement_id=s.id
  WHERE s.deleted_at IS NULL AND (ABS(s.total_amount-COALESCE(i.amount,0))>0.0001 OR ABS(s.settled_amount-COALESCE(i.paid,0))>0.0001
    OR ABS(s.balance-GREATEST(0,COALESCE(i.amount,0)-COALESCE(i.paid,0)))>0.0001)`)
add('statement_orphan', `SELECT x.id,x.statement_id,x.record_id FROM reconciliation_statement_items x
  LEFT JOIN reconciliation_statements s ON s.id=x.statement_id LEFT JOIN payment_records p ON p.id=x.record_id WHERE s.id IS NULL OR p.id IS NULL`)
add('finance_account_balance', `SELECT a.id,a.opening_balance,a.current_balance,COALESCE(t.delta,0) transaction_delta FROM finance_accounts a
  LEFT JOIN (SELECT account_id,SUM(CASE WHEN direction=1 THEN amount ELSE -amount END) delta FROM finance_account_transactions GROUP BY account_id)t ON t.account_id=a.id
  WHERE ABS(a.current_balance-a.opening_balance-COALESCE(t.delta,0))>0.0001`)
add('invoice_arithmetic', `SELECT id,source_type,source_id,amount_no_tax,tax_amount,amount_with_tax FROM fin_invoices
  WHERE deleted_at IS NULL AND ABS(amount_with_tax-amount_no_tax-tax_amount)>0.01`)
add('voucher_balance', `SELECT v.id,v.voucher_no,v.total_debit,v.total_credit,COALESCE(e.debit,0) entry_debit,COALESCE(e.credit,0) entry_credit FROM acct_vouchers v
  LEFT JOIN (SELECT voucher_id,SUM(IF(direction=1,amount,0)) debit,SUM(IF(direction=2,amount,0)) credit FROM acct_voucher_entries GROUP BY voucher_id)e ON e.voucher_id=v.id
  WHERE ABS(v.total_debit-v.total_credit)>0.01 OR ABS(v.total_debit-COALESCE(e.debit,0))>0.01 OR ABS(v.total_credit-COALESCE(e.credit,0))>0.01`)
add('inventory_stock_projection', `SELECT d.product_id,d.warehouse_id,COALESCE(s.quantity,0) stock_qty,COALESCE(c.qty,0) container_qty FROM
  (SELECT product_id,warehouse_id FROM inventory_stock UNION SELECT product_id,warehouse_id FROM inventory_containers WHERE status=1 AND deleted_at IS NULL)d
  LEFT JOIN inventory_stock s ON s.product_id=d.product_id AND s.warehouse_id=d.warehouse_id
  LEFT JOIN (SELECT product_id,warehouse_id,SUM(remaining_qty) qty FROM inventory_containers WHERE status=1 AND deleted_at IS NULL GROUP BY product_id,warehouse_id)c
    ON c.product_id=d.product_id AND c.warehouse_id=d.warehouse_id WHERE ABS(COALESCE(s.quantity,0)-COALESCE(c.qty,0))>0.0001`)
add('inventory_reserved_projection', `SELECT d.product_id,d.warehouse_id,COALESCE(s.reserved,0) stock_reserved,COALESCE(r.qty,0) reservation_qty FROM
  (SELECT product_id,warehouse_id FROM inventory_stock UNION SELECT product_id,warehouse_id FROM stock_reservations WHERE status=1)d
  LEFT JOIN inventory_stock s ON s.product_id=d.product_id AND s.warehouse_id=d.warehouse_id
  LEFT JOIN (SELECT product_id,warehouse_id,SUM(qty) qty FROM stock_reservations WHERE status=1 GROUP BY product_id,warehouse_id)r
    ON r.product_id=d.product_id AND r.warehouse_id=d.warehouse_id WHERE ABS(COALESCE(s.reserved,0)-COALESCE(r.qty,0))>0.0001`)
add('reservation_source_identity', `SELECT r.id,r.ref_id,r.ref_no,o.order_no FROM stock_reservations r LEFT JOIN sale_orders o ON o.id=r.ref_id
  WHERE r.ref_type='sale_order' AND (o.id IS NULL OR r.ref_no<>o.order_no)`, 'review_historical_snapshot')
add('active_reservation_state', `SELECT r.id,r.ref_id,r.ref_no,o.status,o.deleted_at FROM stock_reservations r LEFT JOIN sale_orders o ON o.id=r.ref_id
  WHERE r.ref_type='sale_order' AND r.status=1 AND (o.id IS NULL OR o.deleted_at IS NOT NULL OR o.status IN (1,4))`)
add('container_quantities', `SELECT id,barcode,status,initial_qty,remaining_qty FROM inventory_containers WHERE deleted_at IS NULL AND (remaining_qty<0 OR remaining_qty>initial_qty+0.0001)`)
add('transfer_quantities', `SELECT id,order_id,quantity,deducted_qty,received_qty FROM transfer_order_items
  WHERE quantity<0 OR deducted_qty<0 OR received_qty<0 OR deducted_qty>quantity+0.0001 OR received_qty>deducted_qty+0.0001`)
add('stockcheck_arithmetic', `SELECT id,check_id,book_qty,actual_qty,diff_qty FROM inventory_check_items
  WHERE actual_qty IS NOT NULL AND ABS(diff_qty-(actual_qty-book_qty))>0.0001`)
add('disposal_amount', `SELECT d.id,d.disposal_no,d.total_value,COALESCE(i.amount,0) item_amount FROM inventory_disposal_orders d
  LEFT JOIN (SELECT disposal_id,SUM(quantity*unit_value) amount FROM inventory_disposal_items GROUP BY disposal_id)i ON i.disposal_id=d.id
  WHERE d.deleted_at IS NULL AND ABS(d.total_value-COALESCE(i.amount,0))>0.01`)
add('expense_amount', `SELECT c.id,c.claim_no,c.total_amount,COALESCE(i.amount,0) item_amount FROM expense_claims c
  LEFT JOIN (SELECT claim_id,SUM(amount) amount FROM expense_claim_items GROUP BY claim_id)i ON i.claim_id=c.id
  WHERE c.deleted_at IS NULL AND ABS(c.total_amount-COALESCE(i.amount,0))>0.01`)

async function audit(conn) {
  await conn.query('SET SESSION MAX_EXECUTION_TIME=10000')
  await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
  await conn.query('SET TRANSACTION READ ONLY')
  await conn.beginTransaction()
  const result = { observedAt: new Date().toISOString(), counts: {}, checks: [] }
  try {
    for (const table of tables) {
      const [[row]] = await conn.query(`SELECT COUNT(*) n FROM ${table}`)
      result.counts[table] = Number(row.n)
    }
    for (const { id, sql, interpretation } of checks) {
      try {
        const [rows] = await conn.query(`SELECT audit_rows.*,COUNT(*) OVER() finding_count FROM (${sql}) audit_rows LIMIT 100`)
        const samples = rows.map(row => {
          const sample = { ...row }
          delete sample.finding_count
          return sample
        })
        result.checks.push({ id, interpretation, count: Number(rows[0]?.finding_count || 0), samples })
      } catch (error) { result.checks.push({ id, error: error.code || error.message }) }
    }
    return result
  } finally { await conn.rollback() }
}
async function main() {
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME', 'DB_PASSWORD']) {
    if (process.env[key] === undefined) throw new Error(`缺少 ${key}；不自动加载真实 .env`)
  }
  const mysql = require(require.resolve('mysql2/promise', { paths: [process.cwd(), path.join(__dirname, '..')] }))
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, connectTimeout: 10000 })
  try {
    const result = await audit(c)
    console.log(JSON.stringify(result, null, 2))
    if (result.checks.some(c => c.error)) process.exitCode = 1
    else if (result.checks.some(c => c.count)) process.exitCode = 2
  } finally { await c.end() }
}
if (require.main === module) main().catch(e => { console.error(e.code || e.message); process.exitCode = 1 })
module.exports = { audit, checks }
