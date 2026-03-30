ALTER TABLE `inbound_tasks`
  MODIFY COLUMN `purchase_order_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '采购订单ID（单采购单场景）',
  MODIFY COLUMN `purchase_order_no` VARCHAR(100) DEFAULT NULL COMMENT '采购单号（单采购单或混合显示）';

ALTER TABLE `inbound_task_items`
  ADD COLUMN `purchase_order_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '来源采购单ID' AFTER `task_id`,
  ADD COLUMN `purchase_order_no` VARCHAR(30) DEFAULT NULL COMMENT '来源采购单号' AFTER `purchase_order_id`,
  ADD COLUMN `purchase_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '来源采购单明细ID' AFTER `purchase_order_no`,
  ADD INDEX `idx_inbound_purchase_item` (`purchase_item_id`);
