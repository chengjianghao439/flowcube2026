-- 货架主数据基础表 + 唯一条码 RCK + 6 位数字（与 id 对齐，存量回填）
-- 早期版本依赖 migrate.js 先行创建 warehouse_racks；这里补齐为正式迁移主线。

CREATE TABLE IF NOT EXISTS warehouse_racks (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  warehouse_id   BIGINT UNSIGNED NOT NULL              COMMENT '所属仓库',
  zone           VARCHAR(20)     NOT NULL DEFAULT ''   COMMENT '库区，如 A / B',
  code           VARCHAR(50)     NOT NULL              COMMENT '货架编码，如 A01',
  name           VARCHAR(100)    NOT NULL DEFAULT ''   COMMENT '货架名称',
  max_levels     TINYINT UNSIGNED NOT NULL DEFAULT 5   COMMENT '最大层数',
  max_positions  TINYINT UNSIGNED NOT NULL DEFAULT 10  COMMENT '每层最大位数',
  status         TINYINT(1)      NOT NULL DEFAULT 1    COMMENT '1=启用 2=停用',
  remark         VARCHAR(200)    DEFAULT NULL,
  deleted_at     DATETIME        DEFAULT NULL,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rack_code (warehouse_id, code),
  INDEX idx_rack_warehouse (warehouse_id),
  INDEX idx_rack_zone (warehouse_id, zone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='货架主数据';

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'warehouse_racks'
    AND COLUMN_NAME = 'barcode'
);
SET @ddl_sql := IF(
  @column_exists = 0,
  'ALTER TABLE warehouse_racks ADD COLUMN barcode VARCHAR(32) NULL COMMENT ''货架条码 RCKxxxxxx'' AFTER code',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE warehouse_racks
SET barcode = CONCAT('RCK', LPAD(id, 6, '0'))
WHERE deleted_at IS NULL AND (barcode IS NULL OR barcode = '');

SET @idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'warehouse_racks'
    AND INDEX_NAME = 'uk_rack_barcode'
);
SET @ddl_sql := IF(
  @idx_exists = 0,
  'ALTER TABLE warehouse_racks ADD UNIQUE KEY uk_rack_barcode (barcode)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
