-- 2026-09-18 多维度审计 P1-18：采购退货出库明细缺行级关联，只能按 product_id 关联
-- purchase_return_items，退货单含同一商品两行时 LEFT JOIN 放大 → assertNoShipItemFanout
-- 抛 409，出库被永久卡死（库存与应付永不冲减）。
--
-- 修法：给 warehouse_task_items 加「来源退货明细行」列，出库时按行精确取单价；
-- 并把历史任务里**能唯一确定**的关联回填（同一退货单内同商品只有一行时可安全回填）。
-- 同商品多行的历史任务保持 NULL —— 出库侧会因此给出明确可行动的 409（而不是 JOIN 放大）。

SET @db = DATABASE();

-- 1) 加列（幂等）
SET @sql = IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'warehouse_task_items'
      AND COLUMN_NAME = 'purchase_return_item_id'
  ),
  'ALTER TABLE warehouse_task_items ADD COLUMN purchase_return_item_id BIGINT UNSIGNED NULL COMMENT ''来源采购退货明细行（迁移 247）：出库按行取单价，避免同商品多行 JOIN 放大''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 加索引（幂等）
SET @sql = IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'warehouse_task_items'
      AND INDEX_NAME = 'idx_wti_purchase_return_item'
  ),
  'ALTER TABLE warehouse_task_items ADD INDEX idx_wti_purchase_return_item (purchase_return_item_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) 回填历史：仅当「同一退货单内该商品只有一行」时才能唯一确定，其余留 NULL 由出库侧显式报错
UPDATE warehouse_task_items wti
  JOIN warehouse_tasks wt
    ON wt.id = wti.task_id
   AND wt.task_type = 'purchase_return'
   AND wt.deleted_at IS NULL
  JOIN (
    SELECT return_id, product_id, MIN(id) AS only_item_id, COUNT(*) AS line_count
      FROM purchase_return_items
     GROUP BY return_id, product_id
  ) x
    ON x.return_id = wt.return_id
   AND x.product_id = wti.product_id
   AND x.line_count = 1
   SET wti.purchase_return_item_id = x.only_item_id
 WHERE wti.purchase_return_item_id IS NULL;
