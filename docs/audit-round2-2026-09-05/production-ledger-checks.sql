SET SESSION MAX_EXECUTION_TIME=5000;
SET SESSION TRANSACTION READ ONLY;
START TRANSACTION WITH CONSISTENT SNAPSHOT;
SELECT 'reservation_cache_drift' AS metric,COUNT(*) AS n FROM inventory_stock s LEFT JOIN (SELECT product_id,warehouse_id,SUM(qty) AS qty FROM stock_reservations WHERE status=1 GROUP BY product_id,warehouse_id) r ON r.product_id=s.product_id AND r.warehouse_id=s.warehouse_id WHERE ABS(s.reserved-COALESCE(r.qty,0))>0.0001;
SELECT 'reservation_missing_stock' AS metric,COUNT(*) AS n FROM stock_reservations r LEFT JOIN inventory_stock s ON s.product_id=r.product_id AND s.warehouse_id=r.warehouse_id WHERE r.status=1 AND r.qty>0 AND s.id IS NULL;
SELECT 'voucher_unbalanced' AS metric,COUNT(*) AS n FROM acct_vouchers WHERE ABS(total_debit-total_credit)>0.005;
SELECT 'voucher_entry_total_drift' AS metric,COUNT(*) AS n FROM acct_vouchers v LEFT JOIN (SELECT voucher_id,SUM(CASE WHEN direction=1 THEN amount ELSE 0 END) AS debit,SUM(CASE WHEN direction=2 THEN amount ELSE 0 END) AS credit FROM acct_voucher_entries GROUP BY voucher_id) e ON e.voucher_id=v.id WHERE ABS(v.total_debit-COALESCE(e.debit,0))>0.005 OR ABS(v.total_credit-COALESCE(e.credit,0))>0.005;
COMMIT;
