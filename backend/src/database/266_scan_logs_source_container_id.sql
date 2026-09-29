-- 扫盒取货留痕（批 B1 · 塑料盒作业流）
--
-- 扫塑料盒 `B` 取货时，真实扣减与新的独立身份落在**新生成的整件码 `I`** 上：
-- PICK 的 `scan_logs.container_id` 指向新 `I`；原盒只承载「货从哪来」这一事实，故单列记之。
--
-- 不把盒写进 `scan_logs.container_id`：复核闭合校验按「锁定集合 == 扫码集合」比对，
-- 盒既未被锁定、也不应出现在扫码集合里，否则闭合校验会被破坏。
--
-- 幂等写法（参照 265_inventory_containers_mixed_batch.sql）：information_schema 判列/判索引 + PREPARE。

SET @has_source_container_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scan_logs'
    AND COLUMN_NAME = 'source_container_id'
);

SET @sql := IF(
  @has_source_container_id = 0,
  'ALTER TABLE scan_logs ADD COLUMN source_container_id BIGINT UNSIGNED NULL COMMENT ''扫盒取货：货来自的塑料盒容器ID（此时 container_id 为新生成的整件码）'' AFTER container_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_source_container := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scan_logs'
    AND INDEX_NAME = 'idx_scan_logs_source_container'
);

SET @sql := IF(
  @has_idx_source_container = 0,
  'ALTER TABLE scan_logs ADD INDEX idx_scan_logs_source_container (source_container_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
