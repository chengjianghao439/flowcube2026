-- Keep older rows from overwriting a later completed row for the same stock dimension.
SET @sql := IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_stock_import_rows' AND COLUMN_NAME='product_id'), 'SELECT 1', 'ALTER TABLE inventory_stock_import_rows ADD COLUMN product_id BIGINT UNSIGNED NULL');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_stock_import_rows' AND COLUMN_NAME='warehouse_id'), 'SELECT 1', 'ALTER TABLE inventory_stock_import_rows ADD COLUMN warehouse_id BIGINT UNSIGNED NULL');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_stock_import_rows' AND INDEX_NAME='idx_stock_import_row_dimension'), 'SELECT 1', 'ALTER TABLE inventory_stock_import_rows ADD KEY idx_stock_import_row_dimension (batch_id, product_id, warehouse_id, row_index)');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
