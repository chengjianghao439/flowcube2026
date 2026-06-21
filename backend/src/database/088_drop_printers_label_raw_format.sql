-- 移除 printers.label_raw_format 字段：系统统一使用 ZPL，不再需要区分 TSPL
-- 注意：MySQL 8.0 不支持 ALTER TABLE ... DROP COLUMN IF EXISTS（那是 MariaDB 语法），
-- 在全新库从头迁移时会触发 ER_PARSE_ERROR。改用 information_schema 判断后动态执行，幂等安全。
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'printers'
    AND COLUMN_NAME = 'label_raw_format'
);
SET @ddl := IF(@col_exists > 0, 'ALTER TABLE `printers` DROP COLUMN `label_raw_format`', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
