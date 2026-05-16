-- FlowCube ERP - Migration 085
-- 销售退货 PDA 流程：return_tasks 表 + 容器 PENDING_QA 状态

CREATE TABLE IF NOT EXISTS `return_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_no` VARCHAR(30) NOT NULL COMMENT 'RT前缀',
  `return_type` VARCHAR(20) NOT NULL COMMENT 'purchase / sale',
  `return_id` BIGINT UNSIGNED NOT NULL,
  `return_no` VARCHAR(30) NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_name` VARCHAR(100) NOT NULL DEFAULT '',
  `party_name` VARCHAR(150) DEFAULT NULL COMMENT '客户/供应商名称',
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '1=待收货 2=收货中 3=待质检 4=待上架 5=已完成 6=已取消',
  `submitted_at` DATETIME DEFAULT NULL,
  `submitted_by` BIGINT UNSIGNED DEFAULT NULL,
  `submitted_by_name` VARCHAR(50) DEFAULT NULL,
  `remark` VARCHAR(200) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_no` (`task_no`),
  KEY `idx_return` (`return_type`, `return_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `return_task_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `return_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 sale_return_items.id',
  `product_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50) NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `expected_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '应退数量',
  `received_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已收货数量',
  `checked_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已质检数量',
  `putaway_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已上架数量',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 容器新增 PENDING_QA（待质检）状态
ALTER TABLE `inventory_containers`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1=ACTIVE 2=EMPTY 3=VOID 4=PENDING_PUTAWAY 5=PENDING_QA';
