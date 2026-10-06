-- FlowCube ERP - Migration 277: 不可变处理意图、永久操作证据及未来关联/签认结构。
-- 只建结构，不回填/签认旧单、不关联目标、不扣库/预占/入账。
-- 历史 target_line_id / legacy_disposal_item_id 故意不设明细FK；证据不级联删除。
-- LONGTEXT保存canonical JSON原文；所有UUID规范小写，ascii_bin保持精确唯一身份。
-- CHECK_CLAUSE只按逐CHECK的MySQL8 AST打印形式BINARY精确核对；不删括号/空格/introducer，不重建未知约束。
-- String quote boundaries use observed MySQL8.0.46 metadata bytes via CONCAT/CHAR(92,39), independent of SQL_MODE.
-- print_expr(QT_FORCE_INTRODUCERS)、Item_cond/in/isnull/print_op及JSON_VALID bool源码依据见后端主题文档。

CREATE TABLE IF NOT EXISTS `disposal_handling_operations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operation_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `action` VARCHAR(80) NOT NULL,
  `actor_id` BIGINT UNSIGNED NOT NULL,
  `request_key` VARCHAR(100) NOT NULL,
  `intent_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `payload_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_json` LONGTEXT NOT NULL,
  `source_id` BIGINT UNSIGNED NULL,
  `target_type` VARCHAR(30) NULL,
  `target_id` BIGINT UNSIGNED NULL,
  `target_line_id` BIGINT UNSIGNED NULL,
  `legacy_disposal_id` BIGINT UNSIGNED NULL,
  `resource_type` VARCHAR(50) NULL,
  `resource_id` BIGINT UNSIGNED NULL,
  `response_json` LONGTEXT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_dho_status` CHECK (status IN (0,1)),
  CONSTRAINT `ck_dho_payload` CHECK (JSON_VALID(payload_json)),
  CONSTRAINT `ck_dho_response` CHECK (response_json IS NULL OR JSON_VALID(response_json))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @dh277_shape = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND (
  (COLUMN_NAME='id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned' AND EXTRA LIKE '%auto_increment%') OR
  (COLUMN_NAME='operation_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='action' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=80 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='actor_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='request_key' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=100 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='intent_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='payload_hash' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=64 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='payload_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='source_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='target_type' AND DATA_TYPE='varchar' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=30 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='target_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='target_line_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='legacy_disposal_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='resource_type' AND DATA_TYPE='varchar' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=50 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='resource_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='response_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='YES' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='status' AND DATA_TYPE='tinyint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='created_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='completed_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='YES')));
SET @dh277_sql = IF(@dh277_shape=19, 'SELECT 1', 'SELECT * FROM __disposal_handling_277_column_mismatch__');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_operations' AND tc.CONSTRAINT_NAME='ck_dho_status' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD CONSTRAINT `ck_dho_status` CHECK (status IN (0,1))', IF(BINARY @dh277_check = BINARY '(`status` in (0,1))', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_operations' AND tc.CONSTRAINT_NAME='ck_dho_payload' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD CONSTRAINT `ck_dho_payload` CHECK (JSON_VALID(payload_json))', IF(BINARY @dh277_check = BINARY 'json_valid(`payload_json`)', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_operations' AND tc.CONSTRAINT_NAME='ck_dho_response' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD CONSTRAINT `ck_dho_response` CHECK (response_json IS NULL OR JSON_VALID(response_json))', IF(BINARY @dh277_check = BINARY '((`response_json` is null) or json_valid(`response_json`))', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

CREATE TABLE IF NOT EXISTS `disposal_handling_sources` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `intent_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_operation_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `product_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50) NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_code` VARCHAR(30) NOT NULL,
  `warehouse_name` VARCHAR(100) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `handling_type` TINYINT UNSIGNED NOT NULL,
  `quantity` DECIMAL(12,2) NOT NULL,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_by_name` VARCHAR(50) NOT NULL,
  `request_key` VARCHAR(100) NOT NULL,
  `payload_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_json` LONGTEXT NOT NULL,
  `response_json` LONGTEXT NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `legacy_disposal_id` BIGINT UNSIGNED NULL,
  `legacy_disposal_item_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_dhs_intention` CHECK (quantity > 0 AND revision > 0 AND handling_type IN (1,2,3)),
  CONSTRAINT `ck_dhs_legacy_pair` CHECK ((legacy_disposal_id IS NULL AND legacy_disposal_item_id IS NULL) OR (legacy_disposal_id IS NOT NULL AND legacy_disposal_item_id IS NOT NULL)),
  CONSTRAINT `ck_dhs_payload` CHECK (JSON_VALID(payload_json)),
  CONSTRAINT `ck_dhs_response` CHECK (response_json IS NULL OR JSON_VALID(response_json))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @dh277_shape = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND (
  (COLUMN_NAME='id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned' AND EXTRA LIKE '%auto_increment%') OR
  (COLUMN_NAME='intent_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='created_operation_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='product_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='product_code' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=50 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='product_name' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=150 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='warehouse_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='warehouse_code' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=30 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='warehouse_name' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=100 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='unit' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=20 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='handling_type' AND DATA_TYPE='tinyint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='quantity' AND DATA_TYPE='decimal' AND IS_NULLABLE='NO' AND NUMERIC_PRECISION=12 AND NUMERIC_SCALE=2) OR
  (COLUMN_NAME='created_by' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='created_by_name' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=50 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='request_key' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=100 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='payload_hash' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=64 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='payload_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='response_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='YES' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='revision' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='legacy_disposal_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='legacy_disposal_item_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='created_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='NO')));
SET @dh277_sql = IF(@dh277_shape=22, 'SELECT 1', 'SELECT * FROM __disposal_handling_277_column_mismatch__');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_sources' AND tc.CONSTRAINT_NAME='ck_dhs_intention' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `ck_dhs_intention` CHECK (quantity > 0 AND revision > 0 AND handling_type IN (1,2,3))', IF(BINARY @dh277_check = BINARY '((`quantity` > 0) and (`revision` > 0) and (`handling_type` in (1,2,3)))', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_sources' AND tc.CONSTRAINT_NAME='ck_dhs_legacy_pair' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `ck_dhs_legacy_pair` CHECK ((legacy_disposal_id IS NULL AND legacy_disposal_item_id IS NULL) OR (legacy_disposal_id IS NOT NULL AND legacy_disposal_item_id IS NOT NULL))', IF(BINARY @dh277_check = BINARY '(((`legacy_disposal_id` is null) and (`legacy_disposal_item_id` is null)) or ((`legacy_disposal_id` is not null) and (`legacy_disposal_item_id` is not null)))', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_sources' AND tc.CONSTRAINT_NAME='ck_dhs_payload' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `ck_dhs_payload` CHECK (JSON_VALID(payload_json))', IF(BINARY @dh277_check = BINARY 'json_valid(`payload_json`)', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_sources' AND tc.CONSTRAINT_NAME='ck_dhs_response' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `ck_dhs_response` CHECK (response_json IS NULL OR JSON_VALID(response_json))', IF(BINARY @dh277_check = BINARY '((`response_json` is null) or json_valid(`response_json`))', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

CREATE TABLE IF NOT EXISTS `disposal_handling_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_id` BIGINT UNSIGNED NOT NULL,
  `target_type` VARCHAR(30) NOT NULL,
  `target_id` BIGINT UNSIGNED NOT NULL,
  `target_line_id` BIGINT UNSIGNED NOT NULL,
  `product_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `allocated_quantity` DECIMAL(12,2) NOT NULL,
  `released_quantity` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `final_executed_quantity` DECIMAL(12,2) NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  `created_operation_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `response_json` LONGTEXT NOT NULL,
  `release_operation_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `released_by` BIGINT UNSIGNED NULL,
  `released_by_name` VARCHAR(50) NULL,
  `released_at` DATETIME NULL,
  `release_reason` VARCHAR(500) NULL,
  `release_evidence_json` LONGTEXT NULL,
  `release_response_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_dhl_target` CHECK (target_type IN (_utf8mb4'sale_order',_utf8mb4'purchase_return',_utf8mb4'inventory_disposal')),
  CONSTRAINT `ck_dhl_budget` CHECK (allocated_quantity > 0 AND released_quantity >= 0 AND released_quantity <= allocated_quantity AND ((state=_utf8mb4'ACTIVE' AND released_quantity=0 AND final_executed_quantity IS NULL) OR (state=_utf8mb4'TERMINATED' AND final_executed_quantity IS NOT NULL AND final_executed_quantity >= 0 AND final_executed_quantity <= allocated_quantity AND released_quantity=allocated_quantity-final_executed_quantity))),
  CONSTRAINT `ck_dhl_response` CHECK (JSON_VALID(response_json)),
  CONSTRAINT `ck_dhl_release_json` CHECK ((release_evidence_json IS NULL OR JSON_VALID(release_evidence_json)) AND (release_response_json IS NULL OR JSON_VALID(release_response_json)))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @dh277_shape = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND (
  (COLUMN_NAME='id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned' AND EXTRA LIKE '%auto_increment%') OR
  (COLUMN_NAME='source_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='target_type' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=30 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='target_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='target_line_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='product_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='warehouse_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='unit' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=20 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='allocated_quantity' AND DATA_TYPE='decimal' AND IS_NULLABLE='NO' AND NUMERIC_PRECISION=12 AND NUMERIC_SCALE=2) OR
  (COLUMN_NAME='released_quantity' AND DATA_TYPE='decimal' AND IS_NULLABLE='NO' AND NUMERIC_PRECISION=12 AND NUMERIC_SCALE=2) OR
  (COLUMN_NAME='final_executed_quantity' AND DATA_TYPE='decimal' AND IS_NULLABLE='YES' AND NUMERIC_PRECISION=12 AND NUMERIC_SCALE=2) OR
  (COLUMN_NAME='state' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=16 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='created_operation_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='response_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='release_operation_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='released_by' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='released_by_name' AND DATA_TYPE='varchar' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=50 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='released_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='YES') OR
  (COLUMN_NAME='release_reason' AND DATA_TYPE='varchar' AND IS_NULLABLE='YES' AND CHARACTER_MAXIMUM_LENGTH=500 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='release_evidence_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='YES' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='release_response_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='YES' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='created_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='NO')));
SET @dh277_sql = IF(@dh277_shape=22, 'SELECT 1', 'SELECT * FROM __disposal_handling_277_column_mismatch__');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_links' AND tc.CONSTRAINT_NAME='ck_dhl_target' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `ck_dhl_target` CHECK (target_type IN (_utf8mb4''sale_order'',_utf8mb4''purchase_return'',_utf8mb4''inventory_disposal''))', IF(BINARY @dh277_check = BINARY CONCAT('(`target_type` in (_utf8mb4',CHAR(92,39),'sale_order',CHAR(92,39),',_utf8mb4',CHAR(92,39),'purchase_return',CHAR(92,39),',_utf8mb4',CHAR(92,39),'inventory_disposal',CHAR(92,39),'))'), 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_links' AND tc.CONSTRAINT_NAME='ck_dhl_budget' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `ck_dhl_budget` CHECK (allocated_quantity > 0 AND released_quantity >= 0 AND released_quantity <= allocated_quantity AND ((state=_utf8mb4''ACTIVE'' AND released_quantity=0 AND final_executed_quantity IS NULL) OR (state=_utf8mb4''TERMINATED'' AND final_executed_quantity IS NOT NULL AND final_executed_quantity >= 0 AND final_executed_quantity <= allocated_quantity AND released_quantity=allocated_quantity-final_executed_quantity)))', IF(BINARY @dh277_check = BINARY CONCAT('((`allocated_quantity` > 0) and (`released_quantity` >= 0) and (`released_quantity` <= `allocated_quantity`) and (((`state` = _utf8mb4',CHAR(92,39),'ACTIVE',CHAR(92,39),') and (`released_quantity` = 0) and (`final_executed_quantity` is null)) or ((`state` = _utf8mb4',CHAR(92,39),'TERMINATED',CHAR(92,39),') and (`final_executed_quantity` is not null) and (`final_executed_quantity` >= 0) and (`final_executed_quantity` <= `allocated_quantity`) and (`released_quantity` = (`allocated_quantity` - `final_executed_quantity`)))))'), 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_links' AND tc.CONSTRAINT_NAME='ck_dhl_response' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `ck_dhl_response` CHECK (JSON_VALID(response_json))', IF(BINARY @dh277_check = BINARY 'json_valid(`response_json`)', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='disposal_handling_links' AND tc.CONSTRAINT_NAME='ck_dhl_release_json' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `ck_dhl_release_json` CHECK ((release_evidence_json IS NULL OR JSON_VALID(release_evidence_json)) AND (release_response_json IS NULL OR JSON_VALID(release_response_json)))', IF(BINARY @dh277_check = BINARY '(((`release_evidence_json` is null) or json_valid(`release_evidence_json`)) and ((`release_response_json` is null) or json_valid(`release_response_json`)))', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

CREATE TABLE IF NOT EXISTS `inventory_disposal_conversions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `original_disposal_id` BIGINT UNSIGNED NOT NULL,
  `original_head_json` LONGTEXT NOT NULL,
  `original_items_json` LONGTEXT NOT NULL,
  `approval_snapshot_json` LONGTEXT NOT NULL,
  `signed_by` BIGINT UNSIGNED NOT NULL,
  `signed_by_name` VARCHAR(50) NOT NULL,
  `signed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reason` VARCHAR(500) NOT NULL,
  `payload_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_json` LONGTEXT NOT NULL,
  `operation_uuid` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `response_json` LONGTEXT NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_dhc_json` CHECK (JSON_VALID(original_head_json) AND JSON_VALID(original_items_json) AND JSON_VALID(approval_snapshot_json) AND JSON_VALID(payload_json) AND JSON_VALID(response_json))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @dh277_shape = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND (
  (COLUMN_NAME='id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned' AND EXTRA LIKE '%auto_increment%') OR
  (COLUMN_NAME='original_disposal_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='original_head_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='original_items_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='approval_snapshot_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='signed_by' AND DATA_TYPE='bigint' AND IS_NULLABLE='NO' AND COLUMN_TYPE LIKE '%unsigned') OR
  (COLUMN_NAME='signed_by_name' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=50 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='signed_at' AND DATA_TYPE='datetime' AND IS_NULLABLE='NO') OR
  (COLUMN_NAME='reason' AND DATA_TYPE='varchar' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=500 AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='payload_hash' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=64 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='payload_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci') OR
  (COLUMN_NAME='operation_uuid' AND DATA_TYPE='char' AND IS_NULLABLE='NO' AND CHARACTER_MAXIMUM_LENGTH=36 AND COLLATION_NAME='ascii_bin') OR
  (COLUMN_NAME='response_json' AND DATA_TYPE='longtext' AND IS_NULLABLE='NO' AND COLLATION_NAME='utf8mb4_unicode_ci')));
SET @dh277_sql = IF(@dh277_shape=13, 'SELECT 1', 'SELECT * FROM __disposal_handling_277_column_mismatch__');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_check = (SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='inventory_disposal_conversions' AND tc.CONSTRAINT_NAME='ck_dhc_json' AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES');
SET @dh277_sql = IF(@dh277_check IS NULL, 'ALTER TABLE `inventory_disposal_conversions` ADD CONSTRAINT `ck_dhc_json` CHECK (JSON_VALID(original_head_json) AND JSON_VALID(original_items_json) AND JSON_VALID(approval_snapshot_json) AND JSON_VALID(payload_json) AND JSON_VALID(response_json))', IF(BINARY @dh277_check = BINARY '(json_valid(`original_head_json`) and json_valid(`original_items_json`) and json_valid(`approval_snapshot_json`) and json_valid(`payload_json`) and json_valid(`response_json`))', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_check_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

-- 原无来源头默认NULL；不回填、不改变原目标业务。
SET @dh277_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' AND COLUMN_NAME='disposal_handling_link_id'), 'SELECT 1', 'ALTER TABLE `sale_orders` ADD COLUMN `disposal_handling_link_id` BIGINT UNSIGNED NULL');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' AND COLUMN_NAME='disposal_handling_link_id' AND DATA_TYPE='bigint' AND COLUMN_TYPE LIKE '%unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL), 'SELECT 1', 'SELECT * FROM __disposal_handling_277_marker_mismatch__');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

-- 原无来源头默认NULL；不回填、不改变原目标业务。
SET @dh277_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='purchase_returns' AND COLUMN_NAME='disposal_handling_link_id'), 'SELECT 1', 'ALTER TABLE `purchase_returns` ADD COLUMN `disposal_handling_link_id` BIGINT UNSIGNED NULL');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='purchase_returns' AND COLUMN_NAME='disposal_handling_link_id' AND DATA_TYPE='bigint' AND COLUMN_TYPE LIKE '%unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL), 'SELECT 1', 'SELECT * FROM __disposal_handling_277_marker_mismatch__');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

-- 原无来源头默认NULL；不回填、不改变原目标业务。
SET @dh277_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_orders' AND COLUMN_NAME='disposal_handling_link_id'), 'SELECT 1', 'ALTER TABLE `inventory_disposal_orders` ADD COLUMN `disposal_handling_link_id` BIGINT UNSIGNED NULL');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_orders' AND COLUMN_NAME='disposal_handling_link_id' AND DATA_TYPE='bigint' AND COLUMN_TYPE LIKE '%unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL), 'SELECT 1', 'SELECT * FROM __disposal_handling_277_marker_mismatch__');
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND INDEX_NAME='PRIMARY');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `inventory_disposal_conversions` ADD PRIMARY KEY (`id`)', IF(@dh277_index='id:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND INDEX_NAME='PRIMARY');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_links` ADD PRIMARY KEY (`id`)', IF(@dh277_index='id:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='PRIMARY');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD PRIMARY KEY (`id`)', IF(@dh277_index='id:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND INDEX_NAME='PRIMARY');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD PRIMARY KEY (`id`)', IF(@dh277_index='id:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND INDEX_NAME='uk_dho_operation');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD UNIQUE INDEX `uk_dho_operation` (`operation_uuid`)', IF(@dh277_index='operation_uuid:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND INDEX_NAME='idx_dho_actor_operation');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD INDEX `idx_dho_actor_operation` (`actor_id`,`operation_uuid`)', IF(@dh277_index='actor_id:0:1:BTREE,operation_uuid:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND INDEX_NAME='idx_dho_source');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD INDEX `idx_dho_source` (`source_id`)', IF(@dh277_index='source_id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND INDEX_NAME='idx_dho_legacy');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD INDEX `idx_dho_legacy` (`legacy_disposal_id`)', IF(@dh277_index='legacy_disposal_id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='uk_dhs_intent');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD UNIQUE INDEX `uk_dhs_intent` (`intent_uuid`)', IF(@dh277_index='intent_uuid:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='uk_dhs_legacy_item');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD UNIQUE INDEX `uk_dhs_legacy_item` (`legacy_disposal_item_id`)', IF(@dh277_index='legacy_disposal_item_id:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='idx_dhs_warehouse_id');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD INDEX `idx_dhs_warehouse_id` (`warehouse_id`,`id`)', IF(@dh277_index='warehouse_id:0:1:BTREE,id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='idx_dhs_product_warehouse_id');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD INDEX `idx_dhs_product_warehouse_id` (`product_id`,`warehouse_id`,`id`)', IF(@dh277_index='product_id:0:1:BTREE,warehouse_id:0:1:BTREE,id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='idx_dhs_warehouse_type_id');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD INDEX `idx_dhs_warehouse_type_id` (`warehouse_id`,`handling_type`,`id`)', IF(@dh277_index='warehouse_id:0:1:BTREE,handling_type:0:1:BTREE,id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='idx_dhs_operation');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD INDEX `idx_dhs_operation` (`created_operation_uuid`)', IF(@dh277_index='created_operation_uuid:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='idx_dhs_creator');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD INDEX `idx_dhs_creator` (`created_by`)', IF(@dh277_index='created_by:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND INDEX_NAME='idx_dhs_legacy');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD INDEX `idx_dhs_legacy` (`legacy_disposal_id`)', IF(@dh277_index='legacy_disposal_id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND INDEX_NAME='uk_dhl_target');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_links` ADD UNIQUE INDEX `uk_dhl_target` (`target_type`,`target_id`)', IF(@dh277_index='target_type:0:0:BTREE,target_id:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND INDEX_NAME='idx_dhl_source_id');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_links` ADD INDEX `idx_dhl_source_id` (`source_id`,`id`)', IF(@dh277_index='source_id:0:1:BTREE,id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND INDEX_NAME='idx_dhl_product');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_links` ADD INDEX `idx_dhl_product` (`product_id`)', IF(@dh277_index='product_id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND INDEX_NAME='idx_dhl_warehouse');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_links` ADD INDEX `idx_dhl_warehouse` (`warehouse_id`)', IF(@dh277_index='warehouse_id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND INDEX_NAME='idx_dhl_create_operation');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_links` ADD INDEX `idx_dhl_create_operation` (`created_operation_uuid`)', IF(@dh277_index='created_operation_uuid:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND INDEX_NAME='idx_dhl_release_operation');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_links` ADD INDEX `idx_dhl_release_operation` (`release_operation_uuid`)', IF(@dh277_index='release_operation_uuid:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND INDEX_NAME='idx_dhl_released_by');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `disposal_handling_links` ADD INDEX `idx_dhl_released_by` (`released_by`)', IF(@dh277_index='released_by:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND INDEX_NAME='uk_dhc_original');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `inventory_disposal_conversions` ADD UNIQUE INDEX `uk_dhc_original` (`original_disposal_id`)', IF(@dh277_index='original_disposal_id:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND INDEX_NAME='uk_dhc_operation');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `inventory_disposal_conversions` ADD UNIQUE INDEX `uk_dhc_operation` (`operation_uuid`)', IF(@dh277_index='operation_uuid:0:0:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND INDEX_NAME='idx_dhc_signed_by');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `inventory_disposal_conversions` ADD INDEX `idx_dhc_signed_by` (`signed_by`)', IF(@dh277_index='signed_by:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' AND INDEX_NAME='idx_dh277_link');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `sale_orders` ADD INDEX `idx_dh277_link` (`disposal_handling_link_id`)', IF(@dh277_index='disposal_handling_link_id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='purchase_returns' AND INDEX_NAME='idx_dh277_link');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `purchase_returns` ADD INDEX `idx_dh277_link` (`disposal_handling_link_id`)', IF(@dh277_index='disposal_handling_link_id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_index = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,0),':',NON_UNIQUE,':',INDEX_TYPE) ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_orders' AND INDEX_NAME='idx_dh277_link');
SET @dh277_sql = IF(@dh277_index IS NULL, 'ALTER TABLE `inventory_disposal_orders` ADD INDEX `idx_dh277_link` (`disposal_handling_link_id`)', IF(@dh277_index='disposal_handling_link_id:0:1:BTREE', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_index_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND CONSTRAINT_NAME='fk_dho_actor');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND CONSTRAINT_NAME='fk_dho_actor');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD CONSTRAINT `fk_dho_actor` FOREIGN KEY (`actor_id`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('actor_id:',DATABASE(),':sys_users:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND CONSTRAINT_NAME='fk_dho_source');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND CONSTRAINT_NAME='fk_dho_source');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD CONSTRAINT `fk_dho_source` FOREIGN KEY (`source_id`) REFERENCES `disposal_handling_sources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('source_id:',DATABASE(),':disposal_handling_sources:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND CONSTRAINT_NAME='fk_dho_legacy');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_operations' AND CONSTRAINT_NAME='fk_dho_legacy');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_operations` ADD CONSTRAINT `fk_dho_legacy` FOREIGN KEY (`legacy_disposal_id`) REFERENCES `inventory_disposal_orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('legacy_disposal_id:',DATABASE(),':inventory_disposal_orders:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_product');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_product');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `fk_dhs_product` FOREIGN KEY (`product_id`) REFERENCES `product_items` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('product_id:',DATABASE(),':product_items:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_warehouse');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_warehouse');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `fk_dhs_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('warehouse_id:',DATABASE(),':inventory_warehouses:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_creator');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_creator');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `fk_dhs_creator` FOREIGN KEY (`created_by`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('created_by:',DATABASE(),':sys_users:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_operation');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_operation');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `fk_dhs_operation` FOREIGN KEY (`created_operation_uuid`) REFERENCES `disposal_handling_operations` (`operation_uuid`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('created_operation_uuid:',DATABASE(),':disposal_handling_operations:operation_uuid') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_legacy');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_sources' AND CONSTRAINT_NAME='fk_dhs_legacy');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_sources` ADD CONSTRAINT `fk_dhs_legacy` FOREIGN KEY (`legacy_disposal_id`) REFERENCES `inventory_disposal_orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('legacy_disposal_id:',DATABASE(),':inventory_disposal_orders:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_source');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_source');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `fk_dhl_source` FOREIGN KEY (`source_id`) REFERENCES `disposal_handling_sources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('source_id:',DATABASE(),':disposal_handling_sources:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_product');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_product');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `fk_dhl_product` FOREIGN KEY (`product_id`) REFERENCES `product_items` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('product_id:',DATABASE(),':product_items:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_warehouse');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_warehouse');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `fk_dhl_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `inventory_warehouses` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('warehouse_id:',DATABASE(),':inventory_warehouses:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_create_operation');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_create_operation');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `fk_dhl_create_operation` FOREIGN KEY (`created_operation_uuid`) REFERENCES `disposal_handling_operations` (`operation_uuid`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('created_operation_uuid:',DATABASE(),':disposal_handling_operations:operation_uuid') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_release_operation');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_release_operation');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `fk_dhl_release_operation` FOREIGN KEY (`release_operation_uuid`) REFERENCES `disposal_handling_operations` (`operation_uuid`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('release_operation_uuid:',DATABASE(),':disposal_handling_operations:operation_uuid') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_releaser');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='disposal_handling_links' AND CONSTRAINT_NAME='fk_dhl_releaser');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `disposal_handling_links` ADD CONSTRAINT `fk_dhl_releaser` FOREIGN KEY (`released_by`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('released_by:',DATABASE(),':sys_users:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND CONSTRAINT_NAME='fk_dhc_original');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND CONSTRAINT_NAME='fk_dhc_original');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `inventory_disposal_conversions` ADD CONSTRAINT `fk_dhc_original` FOREIGN KEY (`original_disposal_id`) REFERENCES `inventory_disposal_orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('original_disposal_id:',DATABASE(),':inventory_disposal_orders:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND CONSTRAINT_NAME='fk_dhc_actor');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND CONSTRAINT_NAME='fk_dhc_actor');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `inventory_disposal_conversions` ADD CONSTRAINT `fk_dhc_actor` FOREIGN KEY (`signed_by`) REFERENCES `sys_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('signed_by:',DATABASE(),':sys_users:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND CONSTRAINT_NAME='fk_dhc_operation');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_conversions' AND CONSTRAINT_NAME='fk_dhc_operation');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `inventory_disposal_conversions` ADD CONSTRAINT `fk_dhc_operation` FOREIGN KEY (`operation_uuid`) REFERENCES `disposal_handling_operations` (`operation_uuid`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('operation_uuid:',DATABASE(),':disposal_handling_operations:operation_uuid') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' AND CONSTRAINT_NAME='fk_dh277_sale_link');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' AND CONSTRAINT_NAME='fk_dh277_sale_link');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `sale_orders` ADD CONSTRAINT `fk_dh277_sale_link` FOREIGN KEY (`disposal_handling_link_id`) REFERENCES `disposal_handling_links` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('disposal_handling_link_id:',DATABASE(),':disposal_handling_links:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='purchase_returns' AND CONSTRAINT_NAME='fk_dh277_pr_link');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='purchase_returns' AND CONSTRAINT_NAME='fk_dh277_pr_link');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `purchase_returns` ADD CONSTRAINT `fk_dh277_pr_link` FOREIGN KEY (`disposal_handling_link_id`) REFERENCES `disposal_handling_links` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('disposal_handling_link_id:',DATABASE(),':disposal_handling_links:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;

SET @dh277_fk = (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_orders' AND CONSTRAINT_NAME='fk_dh277_disposal_link');
SET @dh277_rules = (SELECT CONCAT(UPDATE_RULE,':',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_disposal_orders' AND CONSTRAINT_NAME='fk_dh277_disposal_link');
SET @dh277_sql = IF(@dh277_fk IS NULL, 'ALTER TABLE `inventory_disposal_orders` ADD CONSTRAINT `fk_dh277_disposal_link` FOREIGN KEY (`disposal_handling_link_id`) REFERENCES `disposal_handling_links` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT', IF(@dh277_fk=CONCAT('disposal_handling_link_id:',DATABASE(),':disposal_handling_links:id') AND @dh277_rules='RESTRICT:RESTRICT', 'SELECT 1', 'SELECT * FROM __disposal_handling_277_fk_mismatch__'));
PREPARE dh277_stmt FROM @dh277_sql; EXECUTE dh277_stmt; DEALLOCATE PREPARE dh277_stmt;
