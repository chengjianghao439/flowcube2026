-- 装箱行按「来源取货标签」分流（批 B · 塑料盒作业流 B3b）
--
-- NULL  = 按**商品码**装箱（旧 SKU 路径，行为不变）
-- 非 NULL = 该行来自某张**取货标签**（`inventory_containers.id`，即 B1 生成的整件 `I`）
--
-- 为什么要分行：标签货的**份额在拣货那一刻就已归属**，与有没有装、装了没复核都无关。
-- 只按商品累计（旧口径）会让「同一商品的旧 SKU 量」和「标签量」互相吞掉——例如
-- 旧 I 50 + 标签 60 + 90（已复核 200），旧 SKU 路径一旦按商品累加就把 150 也算成自己的。
-- 因此装箱配额必须**按 `label_container_id` 分行**统计，`NULL` 单独一行代表旧 SKU。
--
-- 本列只影响**配额口径**，不改库存数字：`package_items` 与 `inventory_containers` 无数量关联
-- （装箱不影响容器库存，真实扣减发生在出库），作废/删除靠 `packages.status != 3` 的实时 SUM 回收。

SET @has_label_container_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'package_items'
    AND COLUMN_NAME = 'label_container_id'
);

SET @sql := IF(
  @has_label_container_id = 0,
  'ALTER TABLE package_items ADD COLUMN label_container_id BIGINT UNSIGNED NULL COMMENT ''来源取货标签（取货码容器ID）；NULL=按商品码装箱'' AFTER package_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 索引按 AGENTS 约定用**独立幂等 DDL** 补（参照 250_*/251_*）。

SET @has_idx_pi_label := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'package_items'
    AND INDEX_NAME = 'idx_pi_label'
);
SET @sql := IF(
  @has_idx_pi_label = 0,
  'ALTER TABLE package_items ADD INDEX idx_pi_label (label_container_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
