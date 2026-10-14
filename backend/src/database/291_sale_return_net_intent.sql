-- Preserve NULL historical gross-intent returns. No historical marker backfill.
SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_returns' AND COLUMN_NAME='ordinary_net_basis_order_id'), 'SELECT 1', 'ALTER TABLE sale_returns ADD COLUMN ordinary_net_basis_order_id BIGINT UNSIGNED NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ok := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_returns' AND COLUMN_NAME='ordinary_net_basis_order_id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='');
SET @sql := IF(@ok=1, 'SELECT 1', 'SELECT * FROM __ordinary_returns_291_column_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @unexpected := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_returns' AND COLUMN_NAME='ordinary_net_basis_order_id' AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @sql := IF(@unexpected=0, 'SELECT 1', 'SELECT * FROM __ordinary_returns_291_reverse_fk__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
