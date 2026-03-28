-- 调拨单基础表

CREATE TABLE IF NOT EXISTS `transfer_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(30) NOT NULL,
  `from_warehouse_id` BIGINT UNSIGNED NOT NULL,
  `from_warehouse_name` VARCHAR(100) NOT NULL,
  `to_warehouse_id` BIGINT UNSIGNED NOT NULL,
  `to_warehouse_name` VARCHAR(100) NOT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1草稿 2已确认 3已执行 4已取消',
  `remark` VARCHAR(500) DEFAULT NULL,
  `operator_id` BIGINT UNSIGNED NOT NULL,
  `operator_name` VARCHAR(50) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transfer_order_no` (`order_no`),
  KEY `idx_transfer_orders_status` (`status`),
  KEY `idx_transfer_orders_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调拨单主表';

CREATE TABLE IF NOT EXISTS `transfer_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `product_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50) NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `quantity` DECIMAL(14,4) NOT NULL,
  `remark` VARCHAR(200) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transfer_order_items_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调拨单明细';
