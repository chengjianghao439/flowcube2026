-- FlowCube ERP - Migration 108
-- 改单请求的商品明细：每个受影响 product_id 一行，记录新旧 required_qty 与
-- 待物理确认的归还/补拣数量。pending_return_qty > 0 时该行必须等 PDA 确认
-- 容器归还（及必要时的拆箱）才会真正把 picked_qty/sorted_qty/预占降下来。

CREATE TABLE `sale_order_adjustment_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `adjustment_id` BIGINT UNSIGNED NOT NULL,
  `product_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50) DEFAULT NULL,
  `product_name` VARCHAR(100) DEFAULT NULL,
  `old_required_qty` DECIMAL(12,4) NOT NULL,
  `new_required_qty` DECIMAL(12,4) NOT NULL,
  `pending_return_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '需物理放回库位的数量，PDA确认后才释放预占/降低picked_qty',
  `pending_pick_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '需补拣数量（复用现有拣货流程，本字段仅用于展示）',
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1待确认 2已完成 3无需物理动作',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_soai_adjustment` (`adjustment_id`),
  KEY `idx_soai_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
