-- 打印机 client_id 兼容 + 采购/销售退货基础表

SET @has_printers := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'printers'
);

SET @sql := IF(@has_printers = 0, 'SELECT 1', (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE printers ADD COLUMN `client_id` VARCHAR(200) DEFAULT NULL COMMENT ''绑定的本地客户端ID'' AFTER `source`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'printers'
    AND COLUMN_NAME = 'client_id'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `purchase_returns` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `return_no` VARCHAR(30) NOT NULL,
  `supplier_id` BIGINT UNSIGNED NOT NULL,
  `supplier_name` VARCHAR(100) NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_name` VARCHAR(100) NOT NULL,
  `purchase_order_no` VARCHAR(30) DEFAULT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1草稿 2已确认 3已退货 4已取消',
  `total_amount` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `remark` VARCHAR(500) DEFAULT NULL,
  `operator_id` BIGINT UNSIGNED NOT NULL,
  `operator_name` VARCHAR(50) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_purchase_return_no` (`return_no`),
  KEY `idx_purchase_returns_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购退货单主表';

CREATE TABLE IF NOT EXISTS `purchase_return_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `return_id` BIGINT UNSIGNED NOT NULL,
  `product_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50) NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `quantity` DECIMAL(14,4) NOT NULL,
  `unit_price` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `amount` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_purchase_return_items_return_id` (`return_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购退货单明细';

CREATE TABLE IF NOT EXISTS `sale_returns` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `return_no` VARCHAR(30) NOT NULL,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `customer_name` VARCHAR(100) NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_name` VARCHAR(100) NOT NULL,
  `sale_order_no` VARCHAR(30) DEFAULT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1草稿 2已确认 3已退货入库 4已取消',
  `total_amount` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `remark` VARCHAR(500) DEFAULT NULL,
  `operator_id` BIGINT UNSIGNED NOT NULL,
  `operator_name` VARCHAR(50) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sale_return_no` (`return_no`),
  KEY `idx_sale_returns_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售退货单主表';

CREATE TABLE IF NOT EXISTS `sale_return_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `return_id` BIGINT UNSIGNED NOT NULL,
  `product_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50) NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `quantity` DECIMAL(14,4) NOT NULL,
  `unit_price` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `amount` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sale_return_items_return_id` (`return_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售退货单明细';
