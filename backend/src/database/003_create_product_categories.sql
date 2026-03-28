-- FlowCube ERP - Migration 003
-- 商品分类表（基础版本，后续字段由 migrate.js 补齐）

CREATE TABLE IF NOT EXISTS `product_categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL COMMENT '分类名称',
  `sort` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品分类表';
