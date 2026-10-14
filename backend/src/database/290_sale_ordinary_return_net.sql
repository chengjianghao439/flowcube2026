-- Ordinary discounted-sale return evidence. Idempotent empty tables only; no historical backfill.
-- Source is immutable. No receipt->SO FK: refund execution must never reacquire SO.
CREATE TABLE IF NOT EXISTS sale_ordinary_return_bases (
  order_id BIGINT UNSIGNED NOT NULL,
  gross_basis DECIMAL(14,4) NOT NULL,
  discount_basis DECIMAL(14,4) NOT NULL,
  net_basis DECIMAL(14,4) NOT NULL,
  source_snapshot JSON NOT NULL,
  basis_origin VARCHAR(30) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_ordinary_return_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  return_item_id BIGINT UNSIGNED NOT NULL,
  return_task_item_id BIGINT UNSIGNED NOT NULL,
  qualified_qty DECIMAL(18,2) NOT NULL,
  gross_amount DECIMAL(24,10) NOT NULL,
  financial_amount DECIMAL(14,4) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ordinary_return_task_item (return_task_item_id),
  KEY idx_ordinary_return_order (order_id,id),
  KEY idx_ordinary_return_item (return_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SET @shape := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COLUMN_TYPE,':',IS_NULLABLE) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_bases');
SET @sql := IF(@shape='order_id:bigint unsigned:NO,gross_basis:decimal(14,4):NO,discount_basis:decimal(14,4):NO,net_basis:decimal(14,4):NO,source_snapshot:json:NO,basis_origin:varchar(30):NO,created_at:datetime:NO', 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_column_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Reject existing implicit behavior; never repair/drop unknown tables.
SET @ok := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND COLUMN_NAME='id' AND EXTRA='auto_increment');
SET @sql := IF(@ok=1, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_extra_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @unexpected := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('sale_ordinary_return_bases','sale_ordinary_return_receipts') AND ((COLUMN_NAME<>'created_at' AND COLUMN_DEFAULT IS NOT NULL) OR (COLUMN_NAME='created_at' AND LOWER(EXTRA) LIKE '%on update%') OR (NOT (TABLE_NAME='sale_ordinary_return_receipts' AND COLUMN_NAME='id') AND COLUMN_NAME<>'created_at' AND EXTRA<>'')));
SET @sql := IF(@unexpected=0, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_implicit_column_behavior__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @unexpected := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('sale_ordinary_return_bases','sale_ordinary_return_receipts'));
SET @unexpected := @unexpected + (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('sale_ordinary_return_bases','sale_ordinary_return_receipts'));
SET @sql := IF(@unexpected=0, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_implicit_table_behavior__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ok := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_bases' AND COLUMN_NAME='created_at' AND UPPER(COLUMN_DEFAULT) IN ('CURRENT_TIMESTAMP','CURRENT_TIMESTAMP()'));
SET @sql := IF(@ok=1, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_default_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @shape := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COLUMN_TYPE,':',IS_NULLABLE) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts');
SET @sql := IF(@shape='id:bigint unsigned:NO,order_id:bigint unsigned:NO,return_item_id:bigint unsigned:NO,return_task_item_id:bigint unsigned:NO,qualified_qty:decimal(18,2):NO,gross_amount:decimal(24,10):NO,financial_amount:decimal(14,4):NO,created_at:datetime:NO', 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_column_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ok := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND COLUMN_NAME='created_at' AND UPPER(COLUMN_DEFAULT) IN ('CURRENT_TIMESTAMP','CURRENT_TIMESTAMP()'));
SET @sql := IF(@ok=1, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_default_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_bases' AND INDEX_NAME='PRIMARY');
SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_bases' AND INDEX_NAME='PRIMARY');
SET @sql := IF(@cols='order_id' AND @nu=0, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_index_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND INDEX_NAME='PRIMARY');
SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND INDEX_NAME='PRIMARY');
SET @sql := IF(@cols='id' AND @nu=0, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_index_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND INDEX_NAME='uk_ordinary_return_task_item');
SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND INDEX_NAME='uk_ordinary_return_task_item');
SET @sql := IF(@cols='return_task_item_id' AND @nu=0, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_index_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND INDEX_NAME='idx_ordinary_return_order');
SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND INDEX_NAME='idx_ordinary_return_order');
SET @sql := IF(@cols='order_id,id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_index_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND INDEX_NAME='idx_ordinary_return_item');
SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_ordinary_return_receipts' AND INDEX_NAME='idx_ordinary_return_item');
SET @sql := IF(@cols='return_item_id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_index_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ok := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('sale_ordinary_return_bases','sale_ordinary_return_receipts') AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_unicode_ci');
SET @sql := IF(@ok=2, 'SELECT 1', 'SELECT * FROM __ordinary_returns_290_table_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
