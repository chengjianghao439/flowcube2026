-- FlowCube ERP - Migration 084
-- warehouse_tasks 新增退货出库支持

ALTER TABLE `warehouse_tasks`
  ADD COLUMN `task_type` VARCHAR(20) NOT NULL DEFAULT 'sale_out'
    COMMENT 'sale_out=销售出库, purchase_return=采购退货出库' AFTER `task_no`,
  ADD COLUMN `return_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联退货单ID（purchase_returns.id）' AFTER `task_type`;
