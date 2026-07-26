-- FlowCube ERP - Migration 131
-- 库存热点查询复合索引。
--
-- 全系统最热的查询形态（出库 FIFO 扣减、库存缓存同步、可用量判定都走它）：
--   WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL [FOR UPDATE]
--
-- 原有索引只到 idx_product_wh(product_id, warehouse_id)，status / deleted_at 全靠回表过滤。
-- 后果是 FOR UPDATE 会锁住该「商品+仓库」下的**所有**容器行，而不只是在库的那些：
--   · 容器扣空后 status 变 EMPTY(2)，行永久保留（历史追溯需要，本身是对的）
--   · 于是每出一次库就多一行永久锁负担，真正在库的行数却基本恒定
--   · 一年后单个热销 SKU 可能堆积上万行 EMPTY，每次出库都要锁一遍
-- 表现为「系统越用越慢，重启也没用」，且加机器无效——瓶颈是行锁不是 CPU。
--
-- 加上 status + deleted_at 后，锁范围收敛到真正在库的容器，EMPTY/VOID 历史行不再参与，
-- 表可以继续无限增长而不影响出库性能（审计 P1-9）。
--
-- 实测（本地库 product_id=1 / warehouse_id=1，407 行容器）：
--   加索引前：Index lookup ... rows=407 → Filter(status, deleted_at, locked_by_task_id)
--   加索引后：见迁移执行后的 EXPLAIN，扫描行数收敛到实际在库容器数
--
-- 保留 idx_product_wh 不动：它仍被只按商品+仓库聚合的报表类查询使用，且是本索引的前缀，
-- 删掉会让那些查询退化成全表扫描。

SET @exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'inventory_containers'
    AND index_name = 'idx_container_hot'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `inventory_containers` ADD INDEX `idx_container_hot` (`product_id`, `warehouse_id`, `status`, `deleted_at`)',
  'SELECT "idx_container_hot already exists" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
