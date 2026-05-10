-- FlowCube ERP - Migration 082
-- 销售订单明细新增型号和颜色字段

ALTER TABLE `sale_order_items`
  ADD COLUMN `spec` VARCHAR(100) DEFAULT NULL COMMENT '型号' AFTER `unit`,
  ADD COLUMN `color` VARCHAR(30) DEFAULT NULL COMMENT '颜色' AFTER `spec`;
