-- 全系统库存闭环：容器 canonical 来源 + 日志追溯 + 导入批次
-- 兼容首次执行中途中断、以及与后续 safeAlter 交错执行的场景。

SET @has_source_type := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'source_type'
);
SET @sql := IF(
  @has_source_type = 0,
  'ALTER TABLE inventory_containers ADD COLUMN source_type VARCHAR(32) NOT NULL DEFAULT ''legacy'' COMMENT ''inbound_task|stockcheck|transfer|return|import|manual|legacy'' AFTER remark',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_audit_missing := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'source_audit_missing'
);
SET @sql := IF(
  @has_source_audit_missing = 0,
  'ALTER TABLE inventory_containers ADD COLUMN source_audit_missing TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1=缺 source_ref_id 等'' AFTER source_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_putaway_flagged_overdue := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'putaway_flagged_overdue'
);
SET @sql := IF(
  @has_putaway_flagged_overdue = 0,
  'ALTER TABLE inventory_containers ADD COLUMN putaway_flagged_overdue TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1=待上架超24h'' AFTER source_audit_missing',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE inventory_containers
SET source_type = CASE COALESCE(source_ref_type, '')
  WHEN 'inbound_task' THEN 'inbound_task'
  WHEN 'stockcheck' THEN 'stockcheck'
  WHEN 'transfer' THEN 'transfer'
  WHEN 'sale_return' THEN 'return'
  WHEN 'purchase_return' THEN 'return'
  WHEN 'manual' THEN 'manual'
  WHEN 'purchase_order' THEN 'manual'
  ELSE 'legacy'
END
WHERE source_type = 'legacy' OR source_type IS NULL;

UPDATE inventory_containers
SET source_audit_missing = 1
WHERE source_ref_id IS NULL;

SET @has_ref_no := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'ref_no'
);
SET @container_after := IF(@has_ref_no = 1, 'ref_no', 'operator_name');

SET @has_container_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'container_id'
);
SET @sql := IF(
  @has_container_id = 0,
  CONCAT('ALTER TABLE inventory_logs ADD COLUMN container_id BIGINT UNSIGNED NULL COMMENT ''关联容器'' AFTER ', @container_after),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_log_source_type := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'log_source_type'
);
SET @sql := IF(
  @has_log_source_type = 0,
  'ALTER TABLE inventory_logs ADD COLUMN log_source_type VARCHAR(32) NULL COMMENT ''与容器 source_type 对齐'' AFTER container_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_log_source_ref_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_logs'
    AND COLUMN_NAME = 'log_source_ref_id'
);
SET @sql := IF(
  @has_log_source_ref_id = 0,
  'ALTER TABLE inventory_logs ADD COLUMN log_source_ref_id BIGINT UNSIGNED NULL AFTER log_source_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS inventory_import_batches (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_name     VARCHAR(255) DEFAULT NULL,
  row_count     INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存 Excel 导入批次（容器来源）';
