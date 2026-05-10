-- FlowCube ERP - Migration 081
-- 商品档案字段扩展：SKU编码、货号、颜色、供应商

ALTER TABLE `product_items`
  ADD COLUMN `sku_code` VARCHAR(50) DEFAULT NULL COMMENT 'SKU编码' AFTER `code`,
  ADD COLUMN `article_number` VARCHAR(50) DEFAULT NULL COMMENT '货号' AFTER `sku_code`,
  ADD COLUMN `color` VARCHAR(30) DEFAULT NULL COMMENT '颜色' AFTER `spec`,
  ADD COLUMN `supplier_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '供应商ID' AFTER `category_id`,
  ADD UNIQUE KEY `uk_product_sku_code` (`sku_code`),
  ADD KEY `idx_product_supplier` (`supplier_id`);
