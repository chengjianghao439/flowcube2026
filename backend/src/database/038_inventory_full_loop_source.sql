-- 全系统库存闭环：容器 canonical 来源 + 日志追溯 + 导入批次

ALTER TABLE inventory_containers
  ADD COLUMN source_type VARCHAR(32) NOT NULL DEFAULT 'legacy'
    COMMENT 'inbound_task|stockcheck|transfer|return|import|manual|legacy' AFTER remark,
  ADD COLUMN source_audit_missing TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=缺 source_ref_id 等' AFTER source_type,
  ADD COLUMN putaway_flagged_overdue TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=待上架超24h' AFTER source_audit_missing;

UPDATE inventory_containers SET source_type = CASE COALESCE(source_ref_type, '')
  WHEN 'inbound_task' THEN 'inbound_task'
  WHEN 'stockcheck' THEN 'stockcheck'
  WHEN 'transfer' THEN 'transfer'
  WHEN 'sale_return' THEN 'return'
  WHEN 'purchase_return' THEN 'return'
  WHEN 'manual' THEN 'manual'
  WHEN 'purchase_order' THEN 'manual'
  ELSE 'legacy'
END WHERE source_type = 'legacy' OR source_type IS NULL;

UPDATE inventory_containers SET source_audit_missing = 1 WHERE source_ref_id IS NULL;

ALTER TABLE inventory_logs
  ADD COLUMN container_id BIGINT UNSIGNED NULL COMMENT '关联容器' AFTER ref_no,
  ADD COLUMN log_source_type VARCHAR(32) NULL COMMENT '与容器 source_type 对齐' AFTER container_id,
  ADD COLUMN log_source_ref_id BIGINT UNSIGNED NULL AFTER log_source_type;

CREATE TABLE IF NOT EXISTS inventory_import_batches (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_name     VARCHAR(255) DEFAULT NULL,
  row_count     INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存 Excel 导入批次（容器来源）';
