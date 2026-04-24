-- 销售流程解耦迁移
-- 新流程：占库(2) 与 创建出库任务(3) 拆分为两个独立动作
-- status=2 且已关联仓库任务的订单 → 实际已进入拣货阶段 → 迁移至 status=3（拣货中）
SET @has_sale_task_id := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sale_orders'
    AND COLUMN_NAME = 'task_id'
);

SET @ddl_sql := IF(
  @has_sale_task_id = 1,
  'UPDATE sale_orders SET status = 3 WHERE status = 2 AND task_id IS NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
