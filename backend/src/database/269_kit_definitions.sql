-- C2b-1 independent kit definitions. No virtual product or inventory fact is introduced.
-- Every index/FK is reconciled separately: existing same-name wrong-column definitions fail loud.
CREATE TABLE IF NOT EXISTS kit_definitions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 code VARCHAR(50) NOT NULL,
 name VARCHAR(150) NOT NULL,
 is_active TINYINT(1) NOT NULL DEFAULT 1,
 deleted_at DATETIME NULL,
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 current_version_id BIGINT UNSIGNED NULL,
 active_unique_guard TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS kit_definition_versions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 kit_id BIGINT UNSIGNED NOT NULL,
 version_no INT UNSIGNED NOT NULL,
 reference_unit_price DECIMAL(12,4) NOT NULL,
 created_by BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS kit_definition_components (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 version_id BIGINT UNSIGNED NOT NULL,
 product_id BIGINT UNSIGNED NOT NULL,
 base_qty DECIMAL(12,2) NOT NULL,
 reference_price DECIMAL(12,4) NOT NULL,
 amount_weight DECIMAL(20,6) NOT NULL COMMENT 'A-price(4) x base quantity(2); explicit input limited to 4',
 weight_source VARCHAR(20) NOT NULL,
 sort_no SMALLINT UNSIGNED NOT NULL,
 PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @kit_index_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND INDEX_NAME='uk_kit_code_active');
SET @kit_index_nonunique := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND INDEX_NAME='uk_kit_code_active');
SET @sql := IF(@kit_index_cols IS NULL, 'ALTER TABLE kit_definitions ADD UNIQUE KEY uk_kit_code_active (code,active_unique_guard)', IF(@kit_index_cols='code,active_unique_guard' AND @kit_index_nonunique=0, 'SELECT 1', 'SELECT * FROM __kit_migration_269_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_index_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND INDEX_NAME='uk_kit_version_no');
SET @kit_index_nonunique := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND INDEX_NAME='uk_kit_version_no');
SET @sql := IF(@kit_index_cols IS NULL, 'ALTER TABLE kit_definition_versions ADD UNIQUE KEY uk_kit_version_no (kit_id,version_no)', IF(@kit_index_cols='kit_id,version_no' AND @kit_index_nonunique=0, 'SELECT 1', 'SELECT * FROM __kit_migration_269_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_index_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND INDEX_NAME='uk_kit_version_owner');
SET @kit_index_nonunique := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND INDEX_NAME='uk_kit_version_owner');
SET @sql := IF(@kit_index_cols IS NULL, 'ALTER TABLE kit_definition_versions ADD UNIQUE KEY uk_kit_version_owner (kit_id,id)', IF(@kit_index_cols='kit_id,id' AND @kit_index_nonunique=0, 'SELECT 1', 'SELECT * FROM __kit_migration_269_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_index_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_components' AND INDEX_NAME='uk_kit_component_product');
SET @kit_index_nonunique := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_components' AND INDEX_NAME='uk_kit_component_product');
SET @sql := IF(@kit_index_cols IS NULL, 'ALTER TABLE kit_definition_components ADD UNIQUE KEY uk_kit_component_product (version_id,product_id)', IF(@kit_index_cols='version_id,product_id' AND @kit_index_nonunique=0, 'SELECT 1', 'SELECT * FROM __kit_migration_269_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_index_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_components' AND INDEX_NAME='idx_kit_component_sort');
SET @kit_index_nonunique := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_components' AND INDEX_NAME='idx_kit_component_sort');
SET @sql := IF(@kit_index_cols IS NULL, 'ALTER TABLE kit_definition_components ADD INDEX idx_kit_component_sort (version_id,sort_no,id)', IF(@kit_index_cols='version_id,sort_no,id' AND @kit_index_nonunique=1, 'SELECT 1', 'SELECT * FROM __kit_migration_269_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_index_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_components' AND INDEX_NAME='idx_kit_component_product');
SET @kit_index_nonunique := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_components' AND INDEX_NAME='idx_kit_component_product');
SET @sql := IF(@kit_index_cols IS NULL, 'ALTER TABLE kit_definition_components ADD INDEX idx_kit_component_product (product_id)', IF(@kit_index_cols='product_id' AND @kit_index_nonunique=1, 'SELECT 1', 'SELECT * FROM __kit_migration_269_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_index_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND INDEX_NAME='idx_kit_current_version');
SET @kit_index_nonunique := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND INDEX_NAME='idx_kit_current_version');
SET @sql := IF(@kit_index_cols IS NULL, 'ALTER TABLE kit_definitions ADD INDEX idx_kit_current_version (id,current_version_id)', IF(@kit_index_cols='id,current_version_id' AND @kit_index_nonunique=1, 'SELECT 1', 'SELECT * FROM __kit_migration_269_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_index_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND INDEX_NAME='idx_kit_version_creator');
SET @kit_index_nonunique := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND INDEX_NAME='idx_kit_version_creator');
SET @sql := IF(@kit_index_cols IS NULL, 'ALTER TABLE kit_definition_versions ADD INDEX idx_kit_version_creator (created_by)', IF(@kit_index_cols='created_by' AND @kit_index_nonunique=1, 'SELECT 1', 'SELECT * FROM __kit_migration_269_index_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_fk_columns := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND CONSTRAINT_NAME='fk_kit_version_kit');
SET @sql := IF(@kit_fk_columns IS NULL, 'ALTER TABLE kit_definition_versions ADD CONSTRAINT fk_kit_version_kit FOREIGN KEY (kit_id) REFERENCES kit_definitions (id)', IF(@kit_fk_columns='kit_id:kit_definitions:id', 'SELECT 1', 'SELECT * FROM __kit_migration_269_fk_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_fk_columns := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND CONSTRAINT_NAME='fk_kit_version_creator');
SET @sql := IF(@kit_fk_columns IS NULL, 'ALTER TABLE kit_definition_versions ADD CONSTRAINT fk_kit_version_creator FOREIGN KEY (created_by) REFERENCES sys_users (id)', IF(@kit_fk_columns='created_by:sys_users:id', 'SELECT 1', 'SELECT * FROM __kit_migration_269_fk_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_fk_columns := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_components' AND CONSTRAINT_NAME='fk_kit_component_version');
SET @sql := IF(@kit_fk_columns IS NULL, 'ALTER TABLE kit_definition_components ADD CONSTRAINT fk_kit_component_version FOREIGN KEY (version_id) REFERENCES kit_definition_versions (id)', IF(@kit_fk_columns='version_id:kit_definition_versions:id', 'SELECT 1', 'SELECT * FROM __kit_migration_269_fk_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_fk_columns := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_components' AND CONSTRAINT_NAME='fk_kit_component_product');
SET @sql := IF(@kit_fk_columns IS NULL, 'ALTER TABLE kit_definition_components ADD CONSTRAINT fk_kit_component_product FOREIGN KEY (product_id) REFERENCES product_items (id)', IF(@kit_fk_columns='product_id:product_items:id', 'SELECT 1', 'SELECT * FROM __kit_migration_269_fk_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @kit_fk_columns := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND CONSTRAINT_NAME='fk_kit_current_version');
SET @sql := IF(@kit_fk_columns IS NULL, 'ALTER TABLE kit_definitions ADD CONSTRAINT fk_kit_current_version FOREIGN KEY (id,current_version_id) REFERENCES kit_definition_versions (kit_id,id)', IF(@kit_fk_columns='id:kit_definition_versions:kit_id,current_version_id:kit_definition_versions:id', 'SELECT 1', 'SELECT * FROM __kit_migration_269_fk_mismatch__'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
