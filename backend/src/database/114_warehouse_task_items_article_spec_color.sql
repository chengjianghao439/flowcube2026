-- FlowCube ERP - Migration 114
-- 仓库任务明细补齐货号、型号、颜色字段（与 093/095/096/097 同一模式）：
-- 建任务时从销售单/退货单明细抄写快照，供 PDA 拣货/分拣/复核作业界面按货号核对。

ALTER TABLE `warehouse_task_items`
  ADD COLUMN `article_number` VARCHAR(50) DEFAULT NULL COMMENT '货号' AFTER `unit`,
  ADD COLUMN `spec` VARCHAR(100) DEFAULT NULL COMMENT '型号' AFTER `article_number`,
  ADD COLUMN `color` VARCHAR(30) DEFAULT NULL COMMENT '颜色' AFTER `spec`;
