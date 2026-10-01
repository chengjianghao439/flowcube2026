-- Narrow order evidence current-read indexes and referential integrity. 270 already executed.

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND INDEX_NAME='idx_sale_dispatch_order_confirmed');
SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND INDEX_NAME='idx_sale_dispatch_order_confirmed');
SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_groups ADD INDEX idx_sale_dispatch_order_confirmed (order_id,confirmed_at,id)', IF(@cols='order_id,confirmed_at,id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_271_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND INDEX_NAME='idx_sale_refund_order');
SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND INDEX_NAME='idx_sale_refund_order');
SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_refund_receipts ADD INDEX idx_sale_refund_order (order_id,id)', IF(@cols='order_id,id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_271_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_dispatch_order');
SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_groups ADD CONSTRAINT fk_sale_dispatch_order FOREIGN KEY (order_id) REFERENCES sale_orders (id)', IF(@cols='order_id:sale_orders:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_271_fk_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_refund_order');
SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_refund_receipts ADD CONSTRAINT fk_sale_refund_order FOREIGN KEY (order_id) REFERENCES sale_orders (id)', IF(@cols='order_id:sale_orders:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_271_fk_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
