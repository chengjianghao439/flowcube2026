-- 支付账款表 + 库存流水兼容升级

CREATE TABLE IF NOT EXISTS `payment_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` TINYINT UNSIGNED NOT NULL COMMENT '1=应付 2=应收',
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `order_no` VARCHAR(30) NOT NULL,
  `party_name` VARCHAR(100) NOT NULL,
  `total_amount` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `paid_amount` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `balance` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1未付 2部分付 3已付清',
  `due_date` DATE DEFAULT NULL,
  `remark` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payment_records_type_status` (`type`, `status`),
  KEY `idx_payment_records_order_no` (`order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应收应付记录';

CREATE TABLE IF NOT EXISTS `payment_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `record_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(14,4) NOT NULL,
  `payment_date` DATE NOT NULL,
  `method` VARCHAR(50) DEFAULT NULL,
  `remark` VARCHAR(500) DEFAULT NULL,
  `operator_id` BIGINT UNSIGNED DEFAULT NULL,
  `operator_name` VARCHAR(50) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payment_entries_record_id` (`record_id`),
  CONSTRAINT `fk_payment_entries_record_id`
    FOREIGN KEY (`record_id`) REFERENCES `payment_records` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收付款分录';

SET @has_inventory_logs := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
);

SET @sql := IF(@has_inventory_logs = 0, 'SELECT 1', (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE inventory_logs ADD COLUMN `type` TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT ''1入库 2出库 3调整'' AFTER move_type',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'type'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_inventory_logs = 0, 'SELECT 1', (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE inventory_logs ADD COLUMN `supplier_id` BIGINT UNSIGNED DEFAULT NULL AFTER warehouse_id',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'supplier_id'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_inventory_logs = 0, 'SELECT 1', (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE inventory_logs ADD COLUMN `quantity` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT ''变动数量'' AFTER supplier_id',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'quantity'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_inventory_logs = 0, 'SELECT 1', (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE inventory_logs ADD COLUMN `unit_price` DECIMAL(12,4) DEFAULT NULL AFTER after_qty',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'unit_price'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_change_qty := IF(@has_inventory_logs = 0, 0, (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'change_qty'
));

SET @has_quantity := IF(@has_inventory_logs = 0, 0, (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'quantity'
));

SET @has_type := IF(@has_inventory_logs = 0, 0, (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'type'
));

SET @sql := IF(@has_inventory_logs = 1 AND @has_change_qty = 1 AND @has_quantity = 1,
  'UPDATE inventory_logs SET quantity = ABS(change_qty) WHERE quantity = 0 AND change_qty IS NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_inventory_logs = 1 AND @has_change_qty = 1 AND @has_type = 1,
  'UPDATE inventory_logs SET type = CASE WHEN change_qty < 0 THEN 2 ELSE 1 END WHERE type = 3 AND change_qty IS NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
