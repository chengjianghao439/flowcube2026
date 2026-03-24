-- 为 warehouse_locations 补充 name 字段（安全版本，已存在则跳过）
SET @dbname = DATABASE();
SET @tablename = 'warehouse_locations';
SET @columnname = 'name';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `warehouse_locations` ADD COLUMN `name` VARCHAR(100) NOT NULL DEFAULT '''' AFTER `position`')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
