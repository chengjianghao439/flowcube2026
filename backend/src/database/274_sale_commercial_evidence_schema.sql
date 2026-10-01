-- Exact surviving foreign-key targets include their schema; never accept a cross-schema lookalike.
SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_0');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_0');
SET @sql := IF(@cols='order_id:sale_orders:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_1');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_1');
SET @sql := IF(@cols='kit_version_id:kit_definition_versions:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_2');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_2');
SET @sql := IF(@cols='warehouse_id:inventory_warehouses:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_3');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_3');
SET @sql := IF(@cols='group_id:sale_commercial_groups:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_4');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_4');
SET @sql := IF(@cols='sale_item_id:sale_order_items:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_5');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_5');
SET @sql := IF(@cols='product_id:product_items:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_6');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_6');
SET @sql := IF(@cols='task_id:warehouse_tasks:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_7');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_7');
SET @sql := IF(@cols='group_id:sale_commercial_groups:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_component_money' AND CONSTRAINT_NAME='fk_sale_commercial_270_8');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_component_money' AND CONSTRAINT_NAME='fk_sale_commercial_270_8');
SET @sql := IF(@cols='dispatch_group_id:sale_dispatch_groups:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_component_money' AND CONSTRAINT_NAME='fk_sale_commercial_270_9');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_component_money' AND CONSTRAINT_NAME='fk_sale_commercial_270_9');
SET @sql := IF(@cols='component_id:sale_commercial_components:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_11');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_11');
SET @sql := IF(@cols='dispatch_component_id:sale_dispatch_component_money:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_12');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_12');
SET @sql := IF(@cols='return_item_id:sale_return_items:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_13');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_13');
SET @sql := IF(@cols='return_task_item_id:return_task_items:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND CONSTRAINT_NAME='fk_sale_commercial_270_14');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND CONSTRAINT_NAME='fk_sale_commercial_270_14');
SET @sql := IF(@cols='commercial_component_id:sale_commercial_components:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND CONSTRAINT_NAME='fk_sale_commercial_270_15');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND CONSTRAINT_NAME='fk_sale_commercial_270_15');
SET @sql := IF(@cols='dispatch_component_id:sale_dispatch_component_money:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_dispatch_order');
SET @same_schema := (SELECT MIN(REFERENCED_TABLE_SCHEMA=DATABASE()) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_dispatch_order');
SET @sql := IF(@cols='order_id:sale_orders:id' AND @same_schema=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_274_fk_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @shape := (SELECT CONCAT(COLUMN_TYPE,':',IS_NULLABLE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND COLUMN_NAME='order_gross_basis');
SET @sql := IF(@shape='decimal(14,2):YES', 'SELECT 1', 'SELECT * FROM __sale_commercial_274_column_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @shape := (SELECT CONCAT(COLUMN_TYPE,':',IS_NULLABLE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND COLUMN_NAME='discount_basis');
SET @sql := IF(@shape='decimal(14,4):YES', 'SELECT 1', 'SELECT * FROM __sale_commercial_274_column_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @shape := (SELECT CONCAT(COLUMN_TYPE,':',IS_NULLABLE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND COLUMN_NAME='financial_amount');
SET @sql := IF(@shape='decimal(14,4):YES', 'SELECT 1', 'SELECT * FROM __sale_commercial_274_column_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

