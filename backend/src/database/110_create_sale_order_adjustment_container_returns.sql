-- FlowCube ERP - Migration 110
-- 改单减量命中已拣/已分拣数量时，需要物理归还库位的容器登记表，PDA 扫码确认
-- 目标库位后才真正解锁容器、把 picked_qty/sorted_qty 降下来。

CREATE TABLE `sale_order_adjustment_container_returns` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `adjustment_item_id` BIGINT UNSIGNED NOT NULL,
  `source_container_id` BIGINT UNSIGNED NOT NULL,
  `qty` DECIMAL(12,4) NOT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1待归还 2已归还',
  `target_location_id` BIGINT UNSIGNED DEFAULT NULL,
  `confirmed_by` BIGINT UNSIGNED DEFAULT NULL,
  `confirmed_by_name` VARCHAR(50) DEFAULT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_soacr_item` (`adjustment_item_id`),
  KEY `idx_soacr_container` (`source_container_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
