-- FlowCube ERP - Migration 262
-- 销售退货返货出库（任务 1 第二期）：warehouse_task_items 行级关联销售退货明细行
--
-- 与迁移 247（purchase_return_item_id）同一个理由：出库要按「任务明细行 → 退货明细行」精确取单价与
-- 规格，不能按 (return_id, product_id) 关联——同一退货单里同商品有两行时会 JOIN 放大，
-- assertNoShipItemFanout 抛 409 把出库永久卡死，或者（更糟）静默多扣一次库存。
--
-- 另把 warehouse_tasks.task_type 的注释补全（新增取值 sale_return_out=销售退货返货出库）。
-- 该列在 084 已是 VARCHAR(20)，只需 UPDATE 列注释，不需要改类型。
--
-- 全部语句幂等（AGENTS.md 要求）：新增对象按 information_schema 判断后再建，
-- 已存在的列按「注释现值」条件校验并在不符时修正列定义与位置。

SET @db = DATABASE();

-- 1) 加列（幂等）：不存在才 ADD，且位置固定在 purchase_return_item_id 之后（247 已保证后者存在）
SET @sql = IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'warehouse_task_items'
      AND COLUMN_NAME = 'sale_return_item_id'
  ),
  'ALTER TABLE warehouse_task_items ADD COLUMN sale_return_item_id BIGINT UNSIGNED NULL COMMENT ''来源销售退货明细行（迁移 262）：返货出库按行取单价，避免同商品多行 JOIN 放大'' AFTER purchase_return_item_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 校验并修正列定义（幂等）：列已存在但注释/可空性不符时（人工改过、或上次只跑完一半）修正回目标形态。
--    MODIFY 带 AFTER 保证列序与新建时一致；注释/类型正确时这条不执行。
SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'warehouse_task_items'
      AND COLUMN_NAME = 'sale_return_item_id'
      AND (COLUMN_COMMENT <> '来源销售退货明细行（迁移 262）：返货出库按行取单价，避免同商品多行 JOIN 放大'
           OR IS_NULLABLE <> 'YES'
           OR DATA_TYPE <> 'bigint')
  ),
  'ALTER TABLE warehouse_task_items MODIFY COLUMN sale_return_item_id BIGINT UNSIGNED NULL COMMENT ''来源销售退货明细行（迁移 262）：返货出库按行取单价，避免同商品多行 JOIN 放大'' AFTER purchase_return_item_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) 加索引（幂等）
SET @sql = IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'warehouse_task_items'
      AND INDEX_NAME = 'idx_wti_sale_return_item'
  ),
  'ALTER TABLE warehouse_task_items ADD INDEX idx_wti_sale_return_item (sale_return_item_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) 补全 task_type 列注释（幂等）：只改注释，类型/默认值保持 084 的原样
SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'warehouse_tasks'
      AND COLUMN_NAME = 'task_type'
      AND COLUMN_COMMENT NOT LIKE '%sale_return_out%'
  ),
  'ALTER TABLE warehouse_tasks MODIFY COLUMN task_type VARCHAR(20) NOT NULL DEFAULT ''sale_out'' COMMENT ''sale_out=销售出库, purchase_return=采购退货出库, sale_return_out=销售退货返货出库''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
