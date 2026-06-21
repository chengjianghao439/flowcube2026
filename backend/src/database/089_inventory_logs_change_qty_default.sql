-- inventory_logs.change_qty 是早期遗留列：现行代码统一写 quantity/before_qty/after_qty，
-- 不再写 change_qty。在「从 006 全新建库」的环境该列存在且 NOT NULL 无默认值，
-- MySQL 严格模式(8.0默认)下 INSERT 不提供它会报错；但部分历史演进的库（如生产）
-- 已无该列。故用 information_schema 判断：列存在才补默认值，避免在无该列的库上 ER_BAD_FIELD_ERROR。
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'change_qty'
);
SET @ddl := IF(@col_exists > 0,
  'ALTER TABLE `inventory_logs` MODIFY COLUMN `change_qty` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT ''变动数量（遗留列，现统一用 quantity）''',
  'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
