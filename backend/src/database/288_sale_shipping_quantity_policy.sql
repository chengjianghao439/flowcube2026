-- New master data defaults to integer quantities. Never rewrite existing flags,
-- quantities, units, prices, conversion metadata, or historical documents.
ALTER TABLE product_items ALTER COLUMN allow_decimal_qty SET DEFAULT 0;

-- Snapshots retain original creation-time policy as audit evidence only.
-- NULL identifies pre-policy documents; neither value exempts future quantity
-- operations from the current product policy and safe-disable dependency guard.
SET @db = DATABASE();
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_items' AND COLUMN_NAME='allow_decimal_qty_snapshot'),
  'SELECT 1', 'ALTER TABLE sale_order_items ADD COLUMN allow_decimal_qty_snapshot TINYINT NULL DEFAULT NULL COMMENT ''原单出货数量规则，NULL=旧单兼容''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='warehouse_task_items' AND COLUMN_NAME='allow_decimal_qty_snapshot'),
  'SELECT 1', 'ALTER TABLE warehouse_task_items ADD COLUMN allow_decimal_qty_snapshot TINYINT NULL DEFAULT NULL COMMENT ''原任务出货数量规则，NULL=旧单兼容''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
