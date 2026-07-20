-- 补齐漂移列：warehouse_task_items.sorted_qty 在 012_create_warehouse_tasks.sql 建表时
-- 未声明，但代码（warehouse-tasks.sort.js / warehouse-tasks.cancel-return.js /
-- warehouse-tasks.query.js / sorting-bins.service.js）长期依赖这一列，本机与生产库
-- 实际都已经有这一列（历史上手工 ALTER 加的，git 历史里找不到任何加它的迁移文件），
-- 但 migrations 目录从未记录，导致全新库（如 CI）跑完全部迁移后仍缺这一列。
-- 沿用 088/102/103 的写法：information_schema 判断后动态执行，兼容 MySQL 8.0 且幂等安全。
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'warehouse_task_items'
    AND COLUMN_NAME = 'sorted_qty'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `warehouse_task_items` ADD COLUMN `sorted_qty` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT ''已分拣数量'' AFTER `picked_qty`',
  'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
