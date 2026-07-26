-- FlowCube ERP - Migration 132
-- 容器记录「收货明细行归属」，消除上架量 first-fit 猜测式分配（审计 P1-4）。
--
-- 问题：收货和上架各做一次独立的 first-fit 分配，两次结果可能不一致。
--   · receive()  按 inbound_task_items.id 顺序把实收量灌进 received_qty
--   · putaway()  再按 id 顺序把上架量灌进 putaway_qty（cap = received_qty - putaway_qty）
-- 混单收货（同一商品来自多张采购单、单价不同，系统明确支持 createManualTask）时，
-- 某一箱货实际属于哪张采购单在收货时是已知的，但没有被记下来；上架时只能靠顺序猜。
-- 一旦两次分配错位，结算 SUM(putaway_qty * unit_price) 就会按错误的单价组合计算，
-- 应付金额与采购合同不符；上架时的移动加权成本（avg_cost）同样会取到错误单价。
--
-- 解法：收货建容器时把该箱归属的 inbound_task_items 行记在容器上，上架时按容器携带的
-- 归属精确回写，不足部分才退回原 first-fit 兜底（历史容器 / 跨行箱）。
--
-- 关于拆分：splitContainer 只允许拆 ACTIVE(1) 容器（源容器须为在库状态），待上架容器
-- 不会被拆，因此归属在「收货 → 上架」这段生命周期内不会丢失。上架后拆出的塑料盒不继承
-- 该字段——putaway_qty 此时已回写完毕，归属对它不再有意义。

SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'inventory_containers'
    AND column_name = 'inbound_task_item_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `inventory_containers` ADD COLUMN `inbound_task_item_id` BIGINT UNSIGNED NULL COMMENT ''收货明细行归属（决定上架量回写到哪张采购单的明细）'' AFTER `inbound_task_id`',
  'SELECT "inbound_task_item_id already exists" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'inventory_containers'
    AND index_name = 'idx_container_inbound_item'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE `inventory_containers` ADD INDEX `idx_container_inbound_item` (`inbound_task_item_id`)',
  'SELECT "idx_container_inbound_item already exists" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 存量回填：只回填「归属唯一确定」的容器——该收货订单下该商品只有一行明细时，
-- 这箱货必然属于那一行，不存在猜测。混单（同一商品多行）留 NULL，走 first-fit 兜底，
-- 因为收货时的真实归属已经无从考证，硬猜反而会把错配固化成"精确"结果。
UPDATE inventory_containers c
JOIN (
  SELECT task_id, product_id, MIN(id) AS item_id, COUNT(*) AS line_count
  FROM inbound_task_items
  GROUP BY task_id, product_id
) x ON x.task_id = c.inbound_task_id AND x.product_id = c.product_id AND x.line_count = 1
SET c.inbound_task_item_id = x.item_id
WHERE c.inbound_task_id IS NOT NULL
  AND c.inbound_task_item_id IS NULL;
