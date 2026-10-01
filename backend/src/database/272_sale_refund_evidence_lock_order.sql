-- Refund execution already references immutable shipment component money and actual
-- return items. A redundant refund -> sale order FK implicitly takes an SO lock
-- after stock, reversing shipment's SO -> stock order. Retain order lookup indexes
-- and all source/return-item constraints; remove only the proven redundant FK.
SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_refund_order');
SET @sql := IF(@cols IS NULL, 'SELECT 1', IF(@cols='order_id:sale_orders:id', 'ALTER TABLE sale_commercial_refund_receipts DROP FOREIGN KEY fk_sale_refund_order', 'SELECT * FROM __sale_commercial_272_fk_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
