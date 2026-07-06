-- FlowCube ERP - Migration 095
-- 销售订单明细新增货号字段（型号/颜色已在 082 添加），与采购/调拨对齐

ALTER TABLE `sale_order_items`
  ADD COLUMN `article_number` VARCHAR(50) DEFAULT NULL COMMENT '货号' AFTER `unit`;
