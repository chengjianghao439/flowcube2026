-- FlowCube ERP - Migration 005
-- 库存缓存表（quantity 为缓存值，后续字段由 migrate.js 补齐）

CREATE TABLE IF NOT EXISTS `inventory_stock` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
  `warehouse_id` BIGINT UNSIGNED NOT NULL COMMENT '仓库ID',
  `quantity` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '库存数量缓存',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_wh` (`product_id`, `warehouse_id`),
  KEY `idx_stock_warehouse` (`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存汇总缓存表';
