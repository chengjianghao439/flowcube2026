-- 分拣作业记录（批 B · 塑料盒作业流 B3a）
--
-- 定位：**作业记录与防重**，不是库存事实源，也不参与 syncStockFromContainers()。
-- 「分拣是否完成」始终以 warehouse_tasks.status 与 warehouse_task_items.sorted_qty 为准，
-- 本表只回答「这张取货码在哪个格上、由谁、在何时确认过多少个」。
--
-- 数量口径两位（DECIMAL(12,2)），与全仓数量口径一致。
-- UNIQUE(task_id, container_id)：同一张取货码对同一任务只允许确认一次——重扫即防重拒绝，
-- 幂等重试则由 warehouse_tasks.sort 的 operation request 原键重放承担，不靠本表。
--
-- 注意：本表**不能**用于反推「本任务的取货标签份额」。容器被取消/归还后可合法作为
-- 普通整件再给下一个任务拣，届时容器上的 source_ref_type='plastic_box_pick' 仍是历史
-- 来源、不会自动改变。份额归属一律按「当前 task 的有效取货 PICK 行」（scan_logs
-- scan_purpose=1 且 source_container_id 非空）判定，见 warehouse-tasks.sort.js。

CREATE TABLE IF NOT EXISTS sorting_bin_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bin_id        BIGINT UNSIGNED NOT NULL COMMENT '分拣格 id',
  task_id       BIGINT UNSIGNED NOT NULL COMMENT '仓库任务 id',
  container_id  BIGINT UNSIGNED NOT NULL COMMENT '取货码容器 id（inventory_containers.id）',
  product_id    BIGINT UNSIGNED NOT NULL COMMENT '商品 id（与任务明细一致）',
  qty           DECIMAL(12,2)   NOT NULL COMMENT '本次确认的分拣数量',
  operator_id   BIGINT UNSIGNED NULL,
  operator_name VARCHAR(64)     NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分拣作业记录（Put Wall）；作业记录与防重，非库存事实源';

-- 索引按 AGENTS 约定用**独立幂等 DDL** 补（参照 250_*/251_*）：表可能由上面的
-- CREATE TABLE IF NOT EXISTS 新建，也可能早已存在，两种情形都要能重复执行不报错。

SET @has_uk_task_container := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sorting_bin_items'
    AND INDEX_NAME = 'uk_task_container'
);
SET @sql := IF(
  @has_uk_task_container = 0,
  'ALTER TABLE sorting_bin_items ADD UNIQUE KEY uk_task_container (task_id, container_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_bin := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sorting_bin_items'
    AND INDEX_NAME = 'idx_bin'
);
SET @sql := IF(
  @has_idx_bin = 0,
  'ALTER TABLE sorting_bin_items ADD INDEX idx_bin (bin_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
