-- 塑料盒混批标识（批 A · 塑料盒作业流）
--
-- 业务规则：每盒一种商品，**同商品不同批次允许混放**，本范围**不管理保质期**。
-- 因此混批的放行闸只看「真正的到期事实 exp_date」，不看 batch_no/mfg_date。
--
-- 混批发生后，盒上的 batch_no 已不再代表整盒的单一来源批次；此列用于明确表达
-- 「这是混合来源」，避免用最早那批的 batch_no 冒充单一批次（同时清空盒上的
-- batch_no/mfg_date，原批次来源由 inventory_logs 的 log_source_ref_id 追溯）。
--
-- 幂等写法（参照 017_alter_inventory_containers.sql）：information_schema 判列 + PREPARE。

SET @has_is_mixed_batch := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'is_mixed_batch'
);

SET @sql := IF(
  @has_is_mixed_batch = 0,
  'ALTER TABLE inventory_containers ADD COLUMN is_mixed_batch TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1=盒内混有多个来源批次，盒上的 batch_no 不再代表单一批次'' AFTER remaining_qty',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
