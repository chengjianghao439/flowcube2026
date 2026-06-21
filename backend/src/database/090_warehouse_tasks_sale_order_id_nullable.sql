-- FlowCube ERP - Migration 090
-- warehouse_tasks 销售关联列改为可空：
-- 采购退货出库任务（task_type='purchase_return'）没有关联销售单，
-- createForPurchaseReturn 会写入 sale_order_id / sale_order_no / customer_id 为 NULL，
-- 原 NOT NULL 约束导致采购退货确认 500。
-- MODIFY COLUMN 幂等，重复执行结果一致；MySQL 8.0 兼容。

ALTER TABLE `warehouse_tasks`
  MODIFY COLUMN `sale_order_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联销售单ID（采购退货等非销售出库任务为 NULL）',
  MODIFY COLUMN `sale_order_no` VARCHAR(30) DEFAULT NULL
    COMMENT '关联销售单号（采购退货等非销售出库任务为 NULL）',
  MODIFY COLUMN `customer_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '客户ID（采购退货等非销售出库任务为 NULL）';
