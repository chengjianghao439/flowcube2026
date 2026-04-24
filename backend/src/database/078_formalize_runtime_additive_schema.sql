-- Formalized additive schema patches that previously only lived in migrate.js.
-- This migration is intentionally additive and idempotent. The runtime
-- compatibility layer in migrate.js remains in place for old upgrade paths.

SET SESSION group_concat_max_len = 65535;

-- sale_customers price list fields
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_customers'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `price_list_id` BIGINT UNSIGNED DEFAULT NULL AFTER `is_active`' ddl, 'price_list_id' col_name
  UNION ALL SELECT 2, 'ADD COLUMN `price_list_name` VARCHAR(100) DEFAULT NULL AFTER `price_list_id`', 'price_list_name'
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sale_customers'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `sale_customers` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sale_orders task and shipping fields
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_orders'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `task_id` BIGINT UNSIGNED DEFAULT NULL AFTER `remark`' ddl, 'task_id' col_name
  UNION ALL SELECT 2, 'ADD COLUMN `task_no` VARCHAR(30) DEFAULT NULL AFTER `task_id`', 'task_no'
  UNION ALL SELECT 3, 'ADD COLUMN `carrier` VARCHAR(100) DEFAULT NULL COMMENT ''承运商'' AFTER `task_no`', 'carrier'
  UNION ALL SELECT 4, 'ADD COLUMN `carrier_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''承运商ID'' AFTER `carrier`', 'carrier_id'
  UNION ALL SELECT 5, 'ADD COLUMN `freight_type` TINYINT DEFAULT NULL COMMENT ''运费方式 1寄付 2到付 3第三方付'' AFTER `carrier_id`', 'freight_type'
  UNION ALL SELECT 6, 'ADD COLUMN `receiver_name` VARCHAR(100) DEFAULT NULL COMMENT ''收货人'' AFTER `freight_type`', 'receiver_name'
  UNION ALL SELECT 7, 'ADD COLUMN `receiver_phone` VARCHAR(50) DEFAULT NULL COMMENT ''收货电话'' AFTER `receiver_name`', 'receiver_phone'
  UNION ALL SELECT 8, 'ADD COLUMN `receiver_address` VARCHAR(255) DEFAULT NULL COMMENT ''收货地址'' AFTER `receiver_phone`', 'receiver_address'
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sale_orders'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `sale_orders` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- inventory_stock reservation projection fields
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_stock'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `reserved` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT ''已预占数量'' AFTER `quantity`' ddl, 'reserved' col_name
  UNION ALL SELECT 2, 'ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT ''最近更新时间'' AFTER `reserved`', 'updated_at'
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'inventory_stock'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `inventory_stock` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- inventory_logs traceability fields
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_logs'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `move_type` TINYINT UNSIGNED DEFAULT NULL AFTER `id`' ddl, 'move_type' col_name
  UNION ALL SELECT 2, 'ADD COLUMN `ref_type` VARCHAR(30) DEFAULT NULL AFTER `operator_name`', 'ref_type'
  UNION ALL SELECT 3, 'ADD COLUMN `ref_id` BIGINT UNSIGNED DEFAULT NULL AFTER `ref_type`', 'ref_id'
  UNION ALL SELECT 4, 'ADD COLUMN `ref_no` VARCHAR(30) DEFAULT NULL AFTER `ref_id`', 'ref_no'
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'inventory_logs'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `inventory_logs` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- product_categories tree fields
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_categories'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `parent_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''父分类ID'' AFTER `id`' ddl, 'parent_id' col_name
  UNION ALL SELECT 2, 'ADD COLUMN `code` VARCHAR(50) DEFAULT NULL COMMENT ''分类编码'' AFTER `name`', 'code'
  UNION ALL SELECT 3, 'ADD COLUMN `level` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT ''层级 1-4'' AFTER `parent_id`', 'level'
  UNION ALL SELECT 4, 'ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0 COMMENT ''排序'' AFTER `level`', 'sort_order'
  UNION ALL SELECT 5, 'ADD COLUMN `status` TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''1启用 0停用'' AFTER `sort_order`', 'status'
  UNION ALL SELECT 6, 'ADD COLUMN `path` VARCHAR(500) NOT NULL DEFAULT '''' COMMENT ''祖先路径 如 1/2/3'' AFTER `status`', 'path'
  UNION ALL SELECT 7, 'ADD COLUMN `remark` VARCHAR(500) DEFAULT NULL AFTER `path`', 'remark'
  UNION ALL SELECT 8, 'ADD COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `remark`', 'created_at'
  UNION ALL SELECT 9, 'ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`', 'updated_at'
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'product_categories'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `product_categories` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- carriers type field
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'carriers'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `type` VARCHAR(20) NOT NULL DEFAULT ''express'' COMMENT ''承运商类型：delivery=送货 express=快递 freight=快运 logistics=物流'' AFTER `name`' ddl, 'type' col_name
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'carriers'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `carriers` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- inventory_containers location and task locking fields
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_containers'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `location_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''库位ID'' AFTER `warehouse_id`' ddl, 'location_id' col_name
  UNION ALL SELECT 2, 'ADD COLUMN `locked_by_task_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''锁定该容器的仓库任务ID'' AFTER `location_id`', 'locked_by_task_id'
  UNION ALL SELECT 3, 'ADD COLUMN `locked_at` DATETIME DEFAULT NULL COMMENT ''锁定时间'' AFTER `locked_by_task_id`', 'locked_at'
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'inventory_containers'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `inventory_containers` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND INDEX_NAME = 'idx_container_location'
);
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'location_id'
);
SET @sql := IF(@table_exists = 1 AND @col_exists = 1 AND @idx_exists = 0,
  'ALTER TABLE `inventory_containers` ADD INDEX `idx_container_location` (`location_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND INDEX_NAME = 'idx_container_locked'
);
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_containers'
    AND COLUMN_NAME = 'locked_by_task_id'
);
SET @sql := IF(@table_exists = 1 AND @col_exists = 1 AND @idx_exists = 0,
  'ALTER TABLE `inventory_containers` ADD INDEX `idx_container_locked` (`locked_by_task_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- product_items cost field. Existing fresh schemas already have it; this keeps legacy upgrades explicit.
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_items'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `cost_price` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT ''成本价'' AFTER `barcode`' ddl, 'cost_price' col_name
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'product_items'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `product_items` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- picking_waves priority field
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'picking_waves'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `priority` TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT ''1紧急 2普通 3低'' AFTER `status`' ddl, 'priority' col_name
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'picking_waves'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `picking_waves` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- warehouse_tasks sorting bin fields
SET @table_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse_tasks'
);
SET @adds := NULL;
SELECT GROUP_CONCAT(ddl ORDER BY ord SEPARATOR ', ') INTO @adds
FROM (
  SELECT 1 ord, 'ADD COLUMN `sorting_bin_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''分配的分拣格ID'' AFTER `remark`' ddl, 'sorting_bin_id' col_name
  UNION ALL SELECT 2, 'ADD COLUMN `sorting_bin_code` VARCHAR(20) DEFAULT NULL COMMENT ''分拣格编号'' AFTER `sorting_bin_id`', 'sorting_bin_code'
) desired
WHERE @table_exists = 1
  AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'warehouse_tasks'
      AND COLUMN_NAME = desired.col_name
  );
SET @sql := IF(@adds IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `warehouse_tasks` ', @adds));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
