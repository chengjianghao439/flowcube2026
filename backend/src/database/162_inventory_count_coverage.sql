-- FlowCube ERP - Migration 162
-- 盘点覆盖游标（文档 08，按仓+商品）：每个商品在该仓最后一次被盘完成的时刻。
-- 抽盘"轮到谁"要知道每个商品上次盘于何时；直接反查 inventory_checks 大表成本高，故物化。
-- 全盘单与抽盘单提交成功后都 upsert（统一游标，全盘后短期内不会又被抽盘挑中）。
-- 缺行=从未被盘=最该盘（ORDER BY last_counted_at ASC 时 NULL/缺行排最前）。

CREATE TABLE IF NOT EXISTS `inventory_count_coverage` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `warehouse_id`   BIGINT UNSIGNED NOT NULL,
  `product_id`     BIGINT UNSIGNED NOT NULL,
  `last_counted_at` DATETIME       NOT NULL              COMMENT '该商品在该仓最后一次被盘点提交完成的时刻',
  `last_check_id`  BIGINT UNSIGNED NOT NULL              COMMENT '最后一次覆盖它的盘点单ID',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wh_product` (`warehouse_id`,`product_id`),
  INDEX `idx_wh_last` (`warehouse_id`,`last_counted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点覆盖游标：每商品最后被盘完成时间（全盘/抽盘都写）';
