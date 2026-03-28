-- FlowCube ERP - Migration 006
-- 库存流水表（基础版本，后续字段由 migrate.js 补齐）

CREATE TABLE IF NOT EXISTS `inventory_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
  `warehouse_id` BIGINT UNSIGNED NOT NULL COMMENT '仓库ID',
  `change_qty` DECIMAL(14,4) NOT NULL COMMENT '变动数量',
  `before_qty` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '变动前数量',
  `after_qty` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '变动后数量',
  `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `operator_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '操作人ID',
  `operator_name` VARCHAR(50) DEFAULT NULL COMMENT '操作人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_logs_created_at` (`created_at`),
  KEY `idx_inventory_logs_product_wh` (`product_id`, `warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存流水表';
