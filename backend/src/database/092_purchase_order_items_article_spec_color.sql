-- FlowCube ERP - Migration 092
-- 采购订单明细新增货号、型号、颜色字段（下单时快照，供编辑与详情页展示）

ALTER TABLE `purchase_order_items`
  ADD COLUMN `article_number` VARCHAR(50) DEFAULT NULL COMMENT '货号' AFTER `unit`,
  ADD COLUMN `spec` VARCHAR(100) DEFAULT NULL COMMENT '型号' AFTER `article_number`,
  ADD COLUMN `color` VARCHAR(30) DEFAULT NULL COMMENT '颜色' AFTER `spec`;
