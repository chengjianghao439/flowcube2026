-- 仓库任务主表
CREATE TABLE IF NOT EXISTS `warehouse_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_no` VARCHAR(30) NOT NULL,
  `sale_order_id` BIGINT UNSIGNED NOT NULL,
  `sale_order_no` VARCHAR(30) NOT NULL,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `customer_name` VARCHAR(100) NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_name` VARCHAR(100) NOT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '1=待分配 2=备货中 3=待出库 4=已出库 5=已取消',
  `priority` TINYINT UNSIGNED NOT NULL DEFAULT 2
    COMMENT '1=紧急 2=普通 3=低优先级',
  `assigned_to` BIGINT UNSIGNED DEFAULT NULL,
  `assigned_name` VARCHAR(50) DEFAULT NULL,
  `expected_ship_date` DATE DEFAULT NULL,
  `remark` VARCHAR(300) DEFAULT NULL,
  `shipped_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_no` (`task_no`),
  KEY `idx_sale_order_id` (`sale_order_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 仓库任务明细表
CREATE TABLE IF NOT EXISTS `warehouse_task_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `product_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50) NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `required_qty` DECIMAL(12,4) NOT NULL COMMENT '需备货数量',
  `picked_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已备货数量',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
