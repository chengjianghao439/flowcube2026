-- FlowCube ERP - Migration 109
-- 改单命中已打包商品时，需要作废的已完成箱子登记表，PDA 拆箱扫码确认。
-- 混装箱（同箱内还有未受影响商品）作废后这些商品也需要重新装箱，
-- other_products_snapshot 记录快照供 ERP/PDA 提示。

CREATE TABLE `sale_order_adjustment_package_voids` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `adjustment_item_id` BIGINT UNSIGNED NOT NULL,
  `package_id` BIGINT UNSIGNED NOT NULL,
  `barcode` VARCHAR(30) NOT NULL,
  `other_products_snapshot` JSON DEFAULT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1待拆箱确认 2已确认',
  `confirmed_by` BIGINT UNSIGNED DEFAULT NULL,
  `confirmed_by_name` VARCHAR(50) DEFAULT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_soapv_item` (`adjustment_item_id`),
  KEY `idx_soapv_package` (`package_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
