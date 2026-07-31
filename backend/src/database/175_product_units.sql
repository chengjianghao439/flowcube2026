-- FlowCube ERP - Migration 175
-- 商品多计量单位与换算率（文档 03 · Phase 0）。换算率是商品级（1 箱=多少件 每个 SKU 各不同）。
-- 中心原则：库存事实层永远只用「基本单位」记数，本表只服务录入/展示层的换算，绝不进库存/账款计算。
-- 存量商品 seed 一行 is_base=1、rate=1、unit_name=product_items.unit —— 语义与现状完全等价，零感知。

CREATE TABLE IF NOT EXISTS `product_units` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`       BIGINT UNSIGNED NOT NULL,
  `unit_name`        VARCHAR(20)   NOT NULL              COMMENT '单位名（箱/件/托）',
  `conversion_rate`  DECIMAL(18,6) NOT NULL DEFAULT 1    COMMENT '1 本单位 = N 基本单位；基本单位行恒为 1',
  `is_base`          TINYINT(1)    NOT NULL DEFAULT 0    COMMENT '1=基本单位（每商品唯一）',
  `sort_order`       INT           NOT NULL DEFAULT 0    COMMENT '录入下拉排序',
  `is_active`        TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_unit` (`product_id`,`unit_name`),
  KEY `idx_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品多计量单位与换算率（换算率商品级，文档03）';

-- 存量商品各 seed 一行基本单位（幂等）
INSERT IGNORE INTO `product_units` (product_id, unit_name, conversion_rate, is_base, sort_order)
  SELECT id, COALESCE(NULLIF(unit,''), '个'), 1, 1, 0 FROM `product_items`;
