-- 回填历史整理提交（如 005/011/056/067 所在的 schema 重写）中曾写入迁移文件文本、
-- 但从未真正在生产/本机库落地的列。这些列均为可选/带默认值字段，业务代码从未显式
-- 依赖它们（INSERT 语句从不写这些列名），此前不生效不影响功能；此次补齐是为了让
-- migrations 目录重新成为 schema 的唯一权威来源，避免全新环境与现有环境继续分叉。
-- 沿用 088/102 的写法：用 information_schema 判断后动态执行，兼容 MySQL 8.0 且幂等安全。

-- inventory_stock.created_at
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_stock' AND COLUMN_NAME = 'created_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `inventory_stock` ADD COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `updated_at`',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sys_settings.created_at
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_settings' AND COLUMN_NAME = 'created_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `sys_settings` ADD COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `remark`',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- purchase_return_items.created_at
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_return_items' AND COLUMN_NAME = 'created_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `purchase_return_items` ADD COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `amount`',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sale_return_items.created_at
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_return_items' AND COLUMN_NAME = 'created_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `sale_return_items` ADD COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `amount`',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- operation_logs.biz_type / biz_id / biz_no
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operation_logs' AND COLUMN_NAME = 'biz_type'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `operation_logs` ADD COLUMN `biz_type` VARCHAR(50) DEFAULT NULL AFTER `module`',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operation_logs' AND COLUMN_NAME = 'biz_id'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `operation_logs` ADD COLUMN `biz_id` BIGINT UNSIGNED DEFAULT NULL AFTER `biz_type`',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operation_logs' AND COLUMN_NAME = 'biz_no'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `operation_logs` ADD COLUMN `biz_no` VARCHAR(100) DEFAULT NULL AFTER `biz_id`',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
