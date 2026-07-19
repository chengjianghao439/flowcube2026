-- FlowCube ERP - Migration 100
-- 销售退货质检补充「不合格数量」：return_task_items 新增 rejected_qty 列，
-- inventory_containers 状态新增 REJECTED(6)，用于承接质检不合格、待报废处理的容器。

ALTER TABLE `return_task_items`
  ADD COLUMN `rejected_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '质检不合格数量' AFTER `checked_qty`;

ALTER TABLE `inventory_containers`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1=ACTIVE 2=EMPTY 3=VOID 4=PENDING_PUTAWAY 5=PENDING_QA 6=REJECTED(质检不合格待报废)';
