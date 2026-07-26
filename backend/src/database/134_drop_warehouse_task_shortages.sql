-- FlowCube ERP - Migration 134
-- 删除缺货上报的空壳结构（迁移 117 建的表与列）。
--
-- 117 建了 warehouse_task_shortages 表和 warehouse_tasks.shortage_reported_at 列，
-- 设想的是「PDA 现场上报缺多少 → ERP 决策按实拣改单或线下补货」的闭环，
-- 但功能从未实现：全仓零引用，没有上报入口、没有处理界面、拣货完成也不据此拦截。
--
-- 删除前已确认两边都是空的：
--   生产：warehouse_task_shortages 0 行，shortage_reported_at 非空的任务 0 个
--   本地：仅 1 行 2026-07-23 的手工测试数据
-- 因此本迁移不会丢失任何真实业务数据。
--
-- 保留 117 不动（已执行过的迁移不回改），删除动作单独成一条，历史可追溯：
-- 将来若要重做缺货上报，按那时的需求重新设计表结构即可，不必迁就这份没用过的旧设计。

SET @tbl := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'warehouse_task_shortages'
);
SET @sql := IF(@tbl > 0,
  'DROP TABLE `warehouse_task_shortages`',
  'SELECT "warehouse_task_shortages 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- MySQL 8.0 没有 DROP COLUMN IF EXISTS，用 information_schema 自行判断，保证可重复执行
SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'warehouse_tasks'
    AND column_name = 'shortage_reported_at'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE `warehouse_tasks` DROP COLUMN `shortage_reported_at`',
  'SELECT "shortage_reported_at 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
