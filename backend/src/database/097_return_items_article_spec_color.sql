-- FlowCube ERP - Migration 097
-- 采购退货、销售退货明细新增货号、型号、颜色字段（供选品/详情页展示，绑定原单时从源单明细抄写快照）

ALTER TABLE `purchase_return_items`
  ADD COLUMN `article_number` VARCHAR(50) DEFAULT NULL COMMENT '货号' AFTER `unit`,
  ADD COLUMN `spec` VARCHAR(100) DEFAULT NULL COMMENT '型号' AFTER `article_number`,
  ADD COLUMN `color` VARCHAR(30) DEFAULT NULL COMMENT '颜色' AFTER `spec`;

ALTER TABLE `sale_return_items`
  ADD COLUMN `article_number` VARCHAR(50) DEFAULT NULL COMMENT '货号' AFTER `unit`,
  ADD COLUMN `spec` VARCHAR(100) DEFAULT NULL COMMENT '型号' AFTER `article_number`,
  ADD COLUMN `color` VARCHAR(30) DEFAULT NULL COMMENT '颜色' AFTER `spec`;
