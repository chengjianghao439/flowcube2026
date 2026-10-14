-- Each new physical receipt box retains its server-generated source quantities.
-- Historical boxes have no recoverable per-source split: leave them NULL.
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_containers' AND COLUMN_NAME='inbound_source_quantities'),
  'SELECT 1', 'ALTER TABLE inventory_containers ADD COLUMN inbound_source_quantities JSON NULL COMMENT ''原收货箱各明细来源量，NULL=历史未记录'' AFTER inbound_task_item_id');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
