-- Phase 1 修正：拆分 quantity → initial_qty + remaining_qty，简化 status 语义
-- 需要兼容“首次执行中途中断后再次重跑”的场景，因此使用幂等写法。

SET @has_initial_qty := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'initial_qty'
);

SET @sql := IF(
  @has_initial_qty = 0,
  'ALTER TABLE inventory_containers ADD COLUMN initial_qty DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT ''容器初始入库数量'' AFTER unit',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_remaining_qty := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'remaining_qty'
);

SET @sql := IF(
  @has_remaining_qty = 0,
  'ALTER TABLE inventory_containers ADD COLUMN remaining_qty DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT ''当前剩余数量'' AFTER initial_qty',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_quantity := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'quantity'
);

SET @sql := IF(
  @has_quantity = 1,
  'UPDATE inventory_containers SET initial_qty = quantity, remaining_qty = quantity',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_quantity = 1,
  'ALTER TABLE inventory_containers DROP COLUMN quantity',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- status 说明（通过 COMMENT 固化语义，无需新表）
-- 1 = ACTIVE  容器有效且有库存
-- 2 = EMPTY   容器已清空（remaining_qty = 0）
-- 3 = VOID    容器已作废（手动或系统标记）
ALTER TABLE inventory_containers
  MODIFY COLUMN status TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '1=ACTIVE 2=EMPTY 3=VOID';
