SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'printer_bindings' AND INDEX_NAME = 'uk_tenant_wh_print_type'
  ),
  'ALTER TABLE printer_bindings DROP INDEX uk_tenant_wh_print_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'printer_bindings' AND INDEX_NAME = 'uk_wh_print_type'
  ),
  'ALTER TABLE printer_bindings ADD UNIQUE KEY uk_wh_print_type (warehouse_id, print_type)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tenant_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'printer_health_stats' AND COLUMN_NAME = 'tenant_id'
);

SET @sql = IF(
  @has_tenant_col > 0,
  'ALTER TABLE printer_health_stats DROP PRIMARY KEY, DROP COLUMN tenant_id, ADD PRIMARY KEY (printer_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
