-- FlowCube ERP - Migration 096
-- 收货订单明细新增货号、型号、颜色字段（建单时从采购单明细抄写快照，供候选列表与详情页展示）

ALTER TABLE `inbound_task_items`
  ADD COLUMN `article_number` VARCHAR(50) DEFAULT NULL COMMENT '货号' AFTER `unit`,
  ADD COLUMN `spec` VARCHAR(100) DEFAULT NULL COMMENT '型号' AFTER `article_number`,
  ADD COLUMN `color` VARCHAR(30) DEFAULT NULL COMMENT '颜色' AFTER `spec`;
