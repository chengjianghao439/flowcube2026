-- Migration 278: supplier refund intents, budgets and permanent original acknowledgements.
-- Source only; no cash/AP/stock/accounting writes and no role grants.
-- Permission codes supplier.refund.view/create/confirm/receive are manually assigned via existing sys_role_permissions.
-- All CHECK comparisons use exact MySQL8 AST print forms; no semantic parenthesis removal or unknown constraint rebuild.
-- String quote boundaries use observed MySQL8.0.46 metadata bytes via CONCAT/CHAR(92,39), independent of SQL_MODE.
-- Historical payer account/OUT, supplier/warehouse, allocation AP/PR/statement identities intentionally have no additional FK.
-- Pending operation actor is the only non-null resource parent. New own IN is NULL until F2.

CREATE TABLE IF NOT EXISTS `supplier_refund_operations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operation_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `action` VARCHAR(80) NOT NULL,
  `actor_id` BIGINT UNSIGNED NOT NULL,
  `request_key` VARCHAR(100) NOT NULL,
  `payload_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_json` LONGTEXT NOT NULL,
  `refund_id` BIGINT UNSIGNED NULL,
  `resource_type` VARCHAR(50) NULL,
  `resource_id` BIGINT UNSIGNED NULL,
  `response_json` LONGTEXT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_sro_status` CHECK (status IN (0,1)),
  CONSTRAINT `ck_sro_payload` CHECK (JSON_VALID(payload_json)),
  CONSTRAINT `ck_sro_resource` CHECK ((status=0 AND refund_id IS NULL AND resource_type IS NULL AND resource_id IS NULL AND response_json IS NULL) OR (status=1 AND refund_id IS NOT NULL AND resource_type IS NOT NULL AND resource_id IS NOT NULL AND resource_type=_utf8mb4'supplier_refund_order' AND resource_id=refund_id AND JSON_VALID(response_json) AND response_json IS NOT NULL))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sr278_shape = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND (
  (COLUMN_NAME='id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned' AND EXTRA LIKE '%auto_increment%') OR
  (COLUMN_NAME='operation_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='action' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=80 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='actor_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='request_key' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=100 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='payload_hash' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=64 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='payload_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='refund_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='resource_type' AND DATA_TYPE='varchar' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=50 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='resource_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='response_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='YES' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='status' AND DATA_TYPE='tinyint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='created_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='completed_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='YES')));
SET @sr278_sql = IF(@sr278_shape=14, 'SELECT 1', 'SELECT * FROM __supplier_refund_278_column_mismatch__');
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_operations' AND tc.CONSTRAINT_NAME='ck_sro_status' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD CONSTRAINT `ck_sro_status` CHECK (status IN (0,1))', IF(BINARY @sr278_check = BINARY '(`status` in (0,1))', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_operations' AND tc.CONSTRAINT_NAME='ck_sro_payload' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD CONSTRAINT `ck_sro_payload` CHECK (JSON_VALID(payload_json))', IF(BINARY @sr278_check = BINARY 'json_valid(`payload_json`)', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_operations' AND tc.CONSTRAINT_NAME='ck_sro_resource' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD CONSTRAINT `ck_sro_resource` CHECK ((status=0 AND refund_id IS NULL AND resource_type IS NULL AND resource_id IS NULL AND response_json IS NULL) OR (status=1 AND refund_id IS NOT NULL AND resource_type IS NOT NULL AND resource_id IS NOT NULL AND resource_type=_utf8mb4''supplier_refund_order'' AND resource_id=refund_id AND JSON_VALID(response_json) AND response_json IS NOT NULL))', IF(BINARY @sr278_check = BINARY CONCAT('(((`status` = 0) and (`refund_id` is null) and (`resource_type` is null) and (`resource_id` is null) and (`response_json` is null)) or ((`status` = 1) and (`refund_id` is not null) and (`resource_type` is not null) and (`resource_id` is not null) and (`resource_type` = _utf8mb4',CHAR(92,39),'supplier_refund_order',CHAR(92,39),') and (`resource_id` = `refund_id`) and json_valid(`response_json`) and (`response_json` is not null)))'), 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND INDEX_NAME='PRIMARY');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD PRIMARY KEY (`id`)', IF(@sr278_index='0:id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND INDEX_NAME='uq_sro_uuid');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD UNIQUE INDEX `uq_sro_uuid` (`operation_uuid`)', IF(@sr278_index='0:operation_uuid', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND INDEX_NAME='idx_sro_own');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD INDEX `idx_sro_own` (`actor_id`,`created_at`,`id`)', IF(@sr278_index='1:actor_id,created_at,id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND INDEX_NAME='idx_sro_refund');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD INDEX `idx_sro_refund` (`refund_id`)', IF(@sr278_index='1:refund_id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

CREATE TABLE IF NOT EXISTS `supplier_refund_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `refund_no` VARCHAR(30) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `purchase_order_id` BIGINT UNSIGNED NOT NULL,
  `purchase_return_id` BIGINT UNSIGNED NOT NULL,
  `payment_record_id` BIGINT UNSIGNED NOT NULL,
  `supplier_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `income_account_id` BIGINT UNSIGNED NOT NULL,
  `refund_date` DATE NOT NULL,
  `amount` DECIMAL(14,4) NOT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_operation_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_key` VARCHAR(100) NOT NULL,
  `payload_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `create_payload_json` LONGTEXT NOT NULL,
  `source_snapshot_json` LONGTEXT NOT NULL,
  `source_fingerprint` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `remark` VARCHAR(500) NULL,
  `confirmed_by` BIGINT UNSIGNED NULL,
  `confirmed_at` DATETIME NULL,
  `cancelled_by` BIGINT UNSIGNED NULL,
  `cancelled_at` DATETIME NULL,
  `received_by` BIGINT UNSIGNED NULL,
  `received_at` DATETIME NULL,
  `received_account_type` TINYINT UNSIGNED NULL,
  `fund_transaction_id` BIGINT UNSIGNED NULL,
  `voucher_id` BIGINT UNSIGNED NULL,
  `voucher_generate_error` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_sr_status` CHECK (status IN (1,2,3,4)),
  CONSTRAINT `ck_sr_amount` CHECK (amount>0),
  CONSTRAINT `ck_sr_json` CHECK (JSON_VALID(create_payload_json) AND JSON_VALID(source_snapshot_json)),
  CONSTRAINT `ck_sr_received` CHECK ((status=3 AND received_account_type IN (1,2,3,4,5) AND received_account_type IS NOT NULL AND received_at IS NOT NULL AND fund_transaction_id IS NOT NULL AND received_by IS NOT NULL) OR (status IN (1,2,4) AND received_account_type IS NULL AND received_at IS NULL AND fund_transaction_id IS NULL AND received_by IS NULL))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sr278_shape = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND (
  (COLUMN_NAME='id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned' AND EXTRA LIKE '%auto_increment%') OR
  (COLUMN_NAME='refund_no' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=30 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='company_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='purchase_order_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='purchase_return_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='payment_record_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='supplier_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='warehouse_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='income_account_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='refund_date' AND DATA_TYPE='date' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='amount' AND DATA_TYPE='decimal' AND IS_NULLABLE='NO' AND NUMERIC_PRECISION=14 AND NUMERIC_SCALE=4) OR
  (COLUMN_NAME='status' AND DATA_TYPE='tinyint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='created_by' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='created_operation_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='request_key' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=100 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='payload_hash' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=64 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='create_payload_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='source_snapshot_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='source_fingerprint' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=64 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='remark' AND DATA_TYPE='varchar' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=500 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='confirmed_by' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='confirmed_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='YES') OR
  (COLUMN_NAME='cancelled_by' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='cancelled_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='YES') OR
  (COLUMN_NAME='received_by' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='received_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='YES') OR
  (COLUMN_NAME='received_account_type' AND DATA_TYPE='tinyint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='fund_transaction_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='voucher_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='voucher_generate_error' AND DATA_TYPE='varchar' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=500 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='created_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='updated_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='NO')));
SET @sr278_sql = IF(@sr278_shape=32, 'SELECT 1', 'SELECT * FROM __supplier_refund_278_column_mismatch__');
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_orders' AND tc.CONSTRAINT_NAME='ck_sr_status' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `ck_sr_status` CHECK (status IN (1,2,3,4))', IF(BINARY @sr278_check = BINARY '(`status` in (1,2,3,4))', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_orders' AND tc.CONSTRAINT_NAME='ck_sr_amount' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `ck_sr_amount` CHECK (amount>0)', IF(BINARY @sr278_check = BINARY '(`amount` > 0)', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_orders' AND tc.CONSTRAINT_NAME='ck_sr_json' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `ck_sr_json` CHECK (JSON_VALID(create_payload_json) AND JSON_VALID(source_snapshot_json))', IF(BINARY @sr278_check = BINARY '(json_valid(`create_payload_json`) and json_valid(`source_snapshot_json`))', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_orders' AND tc.CONSTRAINT_NAME='ck_sr_received' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `ck_sr_received` CHECK ((status=3 AND received_account_type IN (1,2,3,4,5) AND received_account_type IS NOT NULL AND received_at IS NOT NULL AND fund_transaction_id IS NOT NULL AND received_by IS NOT NULL) OR (status IN (1,2,4) AND received_account_type IS NULL AND received_at IS NULL AND fund_transaction_id IS NULL AND received_by IS NULL))', IF(BINARY @sr278_check = BINARY '(((`status` = 3) and (`received_account_type` in (1,2,3,4,5)) and (`received_account_type` is not null) and (`received_at` is not null) and (`fund_transaction_id` is not null) and (`received_by` is not null)) or ((`status` in (1,2,4)) and (`received_account_type` is null) and (`received_at` is null) and (`fund_transaction_id` is null) and (`received_by` is null)))', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND INDEX_NAME='PRIMARY');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD PRIMARY KEY (`id`)', IF(@sr278_index='0:id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND INDEX_NAME='uq_sr_no');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD UNIQUE INDEX `uq_sr_no` (`refund_no`)', IF(@sr278_index='0:refund_no', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND INDEX_NAME='uq_sr_created_op');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD UNIQUE INDEX `uq_sr_created_op` (`created_operation_uuid`)', IF(@sr278_index='0:created_operation_uuid', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND INDEX_NAME='idx_sr_wh_status');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD INDEX `idx_sr_wh_status` (`warehouse_id`,`status`,`id`)', IF(@sr278_index='1:warehouse_id,status,id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND INDEX_NAME='idx_sr_own');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD INDEX `idx_sr_own` (`created_by`,`id`)', IF(@sr278_index='1:created_by,id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND INDEX_NAME='idx_sr_pr');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD INDEX `idx_sr_pr` (`purchase_return_id`,`status`,`id`)', IF(@sr278_index='1:purchase_return_id,status,id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

CREATE TABLE IF NOT EXISTS `supplier_refund_allocations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `refund_id` BIGINT UNSIGNED NOT NULL,
  `payment_record_id` BIGINT UNSIGNED NOT NULL,
  `purchase_return_id` BIGINT UNSIGNED NOT NULL,
  `entry_id` BIGINT UNSIGNED NOT NULL,
  `receipt_id` BIGINT UNSIGNED NULL,
  `original_transaction_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(14,4) NOT NULL,
  `budget_state` VARCHAR(10) NOT NULL,
  `source_snapshot_json` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_sra_amount` CHECK (amount>0),
  CONSTRAINT `ck_sra_state` CHECK (budget_state IN (_utf8mb4'draft',_utf8mb4'reserved',_utf8mb4'received',_utf8mb4'released')),
  CONSTRAINT `ck_sra_json` CHECK (JSON_VALID(source_snapshot_json))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sr278_shape = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND (
  (COLUMN_NAME='id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned' AND EXTRA LIKE '%auto_increment%') OR
  (COLUMN_NAME='refund_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='payment_record_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='purchase_return_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='entry_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='receipt_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='original_transaction_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='amount' AND DATA_TYPE='decimal' AND IS_NULLABLE='NO' AND NUMERIC_PRECISION=14 AND NUMERIC_SCALE=4) OR
  (COLUMN_NAME='budget_state' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=10 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='source_snapshot_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='created_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='NO')));
SET @sr278_sql = IF(@sr278_shape=11, 'SELECT 1', 'SELECT * FROM __supplier_refund_278_column_mismatch__');
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_allocations' AND tc.CONSTRAINT_NAME='ck_sra_amount' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD CONSTRAINT `ck_sra_amount` CHECK (amount>0)', IF(BINARY @sr278_check = BINARY '(`amount` > 0)', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_allocations' AND tc.CONSTRAINT_NAME='ck_sra_state' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD CONSTRAINT `ck_sra_state` CHECK (budget_state IN (_utf8mb4''draft'',_utf8mb4''reserved'',_utf8mb4''received'',_utf8mb4''released''))', IF(BINARY @sr278_check = BINARY CONCAT('(`budget_state` in (_utf8mb4',CHAR(92,39),'draft',CHAR(92,39),',_utf8mb4',CHAR(92,39),'reserved',CHAR(92,39),',_utf8mb4',CHAR(92,39),'received',CHAR(92,39),',_utf8mb4',CHAR(92,39),'released',CHAR(92,39),'))'), 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='supplier_refund_allocations' AND tc.CONSTRAINT_NAME='ck_sra_json' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @sr278_sql = IF(@sr278_check IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD CONSTRAINT `ck_sra_json` CHECK (JSON_VALID(source_snapshot_json))', IF(BINARY @sr278_check = BINARY 'json_valid(`source_snapshot_json`)', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_check_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND INDEX_NAME='PRIMARY');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD PRIMARY KEY (`id`)', IF(@sr278_index='0:id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND INDEX_NAME='uq_sra_refund_entry');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD UNIQUE INDEX `uq_sra_refund_entry` (`refund_id`,`entry_id`)', IF(@sr278_index='0:refund_id,entry_id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND INDEX_NAME='idx_sra_ap_budget');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD INDEX `idx_sra_ap_budget` (`payment_record_id`,`entry_id`,`budget_state`,`id`)', IF(@sr278_index='1:payment_record_id,entry_id,budget_state,id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_index = (SELECT CONCAT(MIN(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND INDEX_NAME='idx_sra_pr_budget');
SET @sr278_sql = IF(@sr278_index IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD INDEX `idx_sra_pr_budget` (`purchase_return_id`,`budget_state`,`id`)', IF(@sr278_index='1:purchase_return_id,budget_state,id', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_index_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND CONSTRAINT_NAME='fk_sro_actor');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND CONSTRAINT_NAME='fk_sro_actor');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD CONSTRAINT `fk_sro_actor` FOREIGN KEY (`actor_id`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('actor_id:',DATABASE(),':sys_users:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND CONSTRAINT_NAME='fk_sro_refund');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_operations' AND CONSTRAINT_NAME='fk_sro_refund');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_operations` ADD CONSTRAINT `fk_sro_refund` FOREIGN KEY (`refund_id`) REFERENCES `supplier_refund_orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('refund_id:',DATABASE(),':supplier_refund_orders:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_company');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_company');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_company` FOREIGN KEY (`company_id`) REFERENCES `acct_companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('company_id:',DATABASE(),':acct_companies:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_po');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_po');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_po` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('purchase_order_id:',DATABASE(),':purchase_orders:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_pr');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_pr');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_pr` FOREIGN KEY (`purchase_return_id`) REFERENCES `purchase_returns` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('purchase_return_id:',DATABASE(),':purchase_returns:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_ap');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_ap');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_ap` FOREIGN KEY (`payment_record_id`) REFERENCES `payment_records` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('payment_record_id:',DATABASE(),':payment_records:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_income');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_income');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_income` FOREIGN KEY (`income_account_id`) REFERENCES `finance_accounts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('income_account_id:',DATABASE(),':finance_accounts:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_creator');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_creator');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_creator` FOREIGN KEY (`created_by`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('created_by:',DATABASE(),':sys_users:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_confirmer');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_confirmer');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_confirmer` FOREIGN KEY (`confirmed_by`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('confirmed_by:',DATABASE(),':sys_users:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_canceller');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_canceller');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_canceller` FOREIGN KEY (`cancelled_by`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('cancelled_by:',DATABASE(),':sys_users:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_receiver');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_receiver');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_receiver` FOREIGN KEY (`received_by`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('received_by:',DATABASE(),':sys_users:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_created_op');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_created_op');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_created_op` FOREIGN KEY (`created_operation_uuid`) REFERENCES `supplier_refund_operations` (`operation_uuid`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('created_operation_uuid:',DATABASE(),':supplier_refund_operations:operation_uuid') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_new_in');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_orders' AND CONSTRAINT_NAME='fk_sr_new_in');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_orders` ADD CONSTRAINT `fk_sr_new_in` FOREIGN KEY (`fund_transaction_id`) REFERENCES `finance_account_transactions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('fund_transaction_id:',DATABASE(),':finance_account_transactions:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND CONSTRAINT_NAME='fk_sra_refund');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND CONSTRAINT_NAME='fk_sra_refund');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD CONSTRAINT `fk_sra_refund` FOREIGN KEY (`refund_id`) REFERENCES `supplier_refund_orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('refund_id:',DATABASE(),':supplier_refund_orders:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND CONSTRAINT_NAME='fk_sra_entry');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND CONSTRAINT_NAME='fk_sra_entry');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD CONSTRAINT `fk_sra_entry` FOREIGN KEY (`entry_id`) REFERENCES `payment_entries` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('entry_id:',DATABASE(),':payment_entries:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;

SET @sr278_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND CONSTRAINT_NAME='fk_sra_receipt');
SET @sr278_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='supplier_refund_allocations' AND CONSTRAINT_NAME='fk_sra_receipt');
SET @sr278_sql = IF(@sr278_fk IS NULL, 'ALTER TABLE `supplier_refund_allocations` ADD CONSTRAINT `fk_sra_receipt` FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@sr278_fk=CONCAT('receipt_id:',DATABASE(),':payment_receipts:id') AND @sr278_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __supplier_refund_278_fk_mismatch__'));
PREPARE sr278_stmt FROM @sr278_sql; EXECUTE sr278_stmt; DEALLOCATE PREPARE sr278_stmt;
