-- 成套商品资料：旧主档和不可变版本不回填价格，旧 B/C/D NULL 由消费者回退 A。
-- 新列逐列核完整形状；未知同名漂移失败，不改 269–281。外键单独核列序/引用 schema/规则。

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='category_id');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='category_id' AND DATA_TYPE='bigint' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definitions ADD COLUMN category_id BIGINT UNSIGNED NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='supplier_id');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='supplier_id' AND DATA_TYPE='bigint' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definitions ADD COLUMN supplier_id BIGINT UNSIGNED NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='unit');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='unit' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=20 AND CHARACTER_SET_NAME='utf8mb4' AND COLLATION_NAME='utf8mb4_unicode_ci' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definitions ADD COLUMN unit VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='spec');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='spec' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=200 AND CHARACTER_SET_NAME='utf8mb4' AND COLLATION_NAME='utf8mb4_unicode_ci' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definitions ADD COLUMN spec VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='color');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='color' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=60 AND CHARACTER_SET_NAME='utf8mb4' AND COLLATION_NAME='utf8mb4_unicode_ci' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definitions ADD COLUMN color VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='article_number');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='article_number' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=100 AND CHARACTER_SET_NAME='utf8mb4' AND COLLATION_NAME='utf8mb4_unicode_ci' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definitions ADD COLUMN article_number VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='cost_price');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='cost_price' AND DATA_TYPE='decimal' AND COLUMN_TYPE='decimal(12,4)' AND NUMERIC_PRECISION=12 AND NUMERIC_SCALE=4 AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definitions ADD COLUMN cost_price DECIMAL(12,4) NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='remark');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND COLUMN_NAME='remark' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=30 AND CHARACTER_SET_NAME='utf8mb4' AND COLLATION_NAME='utf8mb4_unicode_ci' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definitions ADD COLUMN remark VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND COLUMN_NAME='sale_price_b');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND COLUMN_NAME='sale_price_b' AND DATA_TYPE='decimal' AND COLUMN_TYPE='decimal(12,4)' AND NUMERIC_PRECISION=12 AND NUMERIC_SCALE=4 AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definition_versions ADD COLUMN sale_price_b DECIMAL(12,4) NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND COLUMN_NAME='sale_price_c');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND COLUMN_NAME='sale_price_c' AND DATA_TYPE='decimal' AND COLUMN_TYPE='decimal(12,4)' AND NUMERIC_PRECISION=12 AND NUMERIC_SCALE=4 AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definition_versions ADD COLUMN sale_price_c DECIMAL(12,4) NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND COLUMN_NAME='sale_price_d');
SET @kit_profile_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kit_definition_versions' AND COLUMN_NAME='sale_price_d' AND DATA_TYPE='decimal' AND COLUMN_TYPE='decimal(12,4)' AND NUMERIC_PRECISION=12 AND NUMERIC_SCALE=4 AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @kit_profile_sql := IF(@kit_profile_exists=0, 'ALTER TABLE kit_definition_versions ADD COLUMN sale_price_d DECIMAL(12,4) NULL DEFAULT NULL', IF(@kit_profile_shape=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_column_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND CONSTRAINT_NAME='fk_kit_category');
SET @kit_profile_fk_columns := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME,':',POSITION_IN_UNIQUE_CONSTRAINT) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND CONSTRAINT_NAME='fk_kit_category');
SET @kit_profile_fk_rules := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND CONSTRAINT_NAME='fk_kit_category' AND UNIQUE_CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='product_categories' AND UNIQUE_CONSTRAINT_NAME='PRIMARY' AND MATCH_OPTION='NONE' AND UPDATE_RULE IN ('RESTRICT','NO ACTION') AND DELETE_RULE IN ('RESTRICT','NO ACTION'));
SET @kit_profile_sql := IF(@kit_profile_fk_exists=0, 'ALTER TABLE kit_definitions ADD CONSTRAINT fk_kit_category FOREIGN KEY (category_id) REFERENCES product_categories (id) ON UPDATE RESTRICT ON DELETE RESTRICT', IF(@kit_profile_fk_exists=1 AND @kit_profile_fk_columns=CONCAT('category_id:',DATABASE(),':product_categories:id:1') AND @kit_profile_fk_rules=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_fk_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;

SET @kit_profile_fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND CONSTRAINT_NAME='fk_kit_supplier');
SET @kit_profile_fk_columns := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_SCHEMA,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME,':',POSITION_IN_UNIQUE_CONSTRAINT) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND CONSTRAINT_NAME='fk_kit_supplier');
SET @kit_profile_fk_rules := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='kit_definitions' AND CONSTRAINT_NAME='fk_kit_supplier' AND UNIQUE_CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='supply_suppliers' AND UNIQUE_CONSTRAINT_NAME='PRIMARY' AND MATCH_OPTION='NONE' AND UPDATE_RULE IN ('RESTRICT','NO ACTION') AND DELETE_RULE IN ('RESTRICT','NO ACTION'));
SET @kit_profile_sql := IF(@kit_profile_fk_exists=0, 'ALTER TABLE kit_definitions ADD CONSTRAINT fk_kit_supplier FOREIGN KEY (supplier_id) REFERENCES supply_suppliers (id) ON UPDATE RESTRICT ON DELETE RESTRICT', IF(@kit_profile_fk_exists=1 AND @kit_profile_fk_columns=CONCAT('supplier_id:',DATABASE(),':supply_suppliers:id:1') AND @kit_profile_fk_rules=1, 'SELECT 1', 'SELECT * FROM __kit_profile_282_fk_mismatch__'));
PREPARE kit_profile_stmt FROM @kit_profile_sql;
EXECUTE kit_profile_stmt;
DEALLOCATE PREPARE kit_profile_stmt;
