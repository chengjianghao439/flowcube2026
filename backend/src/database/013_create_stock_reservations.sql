-- 库存预占记录表
-- 每笔销售单确认时，为其每个商品创建一条预占记录
-- 出库时标记为 fulfilled，取消时标记为 released
CREATE TABLE IF NOT EXISTS `stock_reservations` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`   BIGINT UNSIGNED NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `qty`          DECIMAL(12,4)   NOT NULL,
  `ref_type`     VARCHAR(30)     NOT NULL COMMENT 'sale_order',
  `ref_id`       BIGINT UNSIGNED NOT NULL COMMENT '关联单据ID',
  `ref_no`       VARCHAR(30)     NOT NULL COMMENT '关联单据编号',
  `status`       TINYINT UNSIGNED NOT NULL DEFAULT 1
                 COMMENT '1=预占中 2=已履行 3=已释放',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ref` (`ref_type`, `ref_id`),
  KEY `idx_product_warehouse` (`product_id`, `warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
