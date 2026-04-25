-- Read-only verification for migrations 078 and 079.
-- Safe to run on staging/production after npm run migrate.
-- Expected result: every row should have result = PASS.

SELECT
  '078_columns' AS check_area,
  CONCAT(expected.table_name, '.', expected.column_name) AS check_item,
  expected.expected_definition,
  COALESCE(actual.actual_definition, '<missing>') AS actual_definition,
  IF(actual.column_name IS NULL, 'FAIL', 'PASS') AS result
FROM (
  SELECT 'sale_customers' table_name, 'price_list_id' column_name, 'BIGINT UNSIGNED nullable' expected_definition UNION ALL
  SELECT 'sale_customers', 'price_list_name', 'VARCHAR(100) nullable' UNION ALL
  SELECT 'sale_orders', 'task_id', 'BIGINT UNSIGNED nullable' UNION ALL
  SELECT 'sale_orders', 'task_no', 'VARCHAR(30) nullable' UNION ALL
  SELECT 'sale_orders', 'carrier', 'VARCHAR(100) nullable' UNION ALL
  SELECT 'sale_orders', 'carrier_id', 'BIGINT UNSIGNED nullable' UNION ALL
  SELECT 'sale_orders', 'freight_type', 'TINYINT nullable' UNION ALL
  SELECT 'sale_orders', 'receiver_name', 'VARCHAR(100) nullable' UNION ALL
  SELECT 'sale_orders', 'receiver_phone', 'VARCHAR(50) nullable' UNION ALL
  SELECT 'sale_orders', 'receiver_address', 'VARCHAR(255) nullable' UNION ALL
  SELECT 'inventory_stock', 'reserved', 'DECIMAL(12,4) NOT NULL DEFAULT 0' UNION ALL
  SELECT 'inventory_stock', 'updated_at', 'DATETIME ON UPDATE CURRENT_TIMESTAMP' UNION ALL
  SELECT 'inventory_logs', 'move_type', 'TINYINT UNSIGNED nullable' UNION ALL
  SELECT 'inventory_logs', 'ref_type', 'VARCHAR(30) nullable' UNION ALL
  SELECT 'inventory_logs', 'ref_id', 'BIGINT UNSIGNED nullable' UNION ALL
  SELECT 'inventory_logs', 'ref_no', 'VARCHAR(30) nullable' UNION ALL
  SELECT 'product_categories', 'parent_id', 'BIGINT UNSIGNED nullable' UNION ALL
  SELECT 'product_categories', 'code', 'VARCHAR(50) nullable' UNION ALL
  SELECT 'product_categories', 'level', 'TINYINT UNSIGNED NOT NULL DEFAULT 1' UNION ALL
  SELECT 'product_categories', 'sort_order', 'INT NOT NULL DEFAULT 0' UNION ALL
  SELECT 'product_categories', 'status', 'TINYINT NOT NULL DEFAULT 1' UNION ALL
  SELECT 'product_categories', 'path', 'VARCHAR(500) NOT NULL DEFAULT empty string' UNION ALL
  SELECT 'product_categories', 'remark', 'VARCHAR(500) nullable' UNION ALL
  SELECT 'product_categories', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' UNION ALL
  SELECT 'product_categories', 'updated_at', 'DATETIME ON UPDATE CURRENT_TIMESTAMP' UNION ALL
  SELECT 'carriers', 'type', 'VARCHAR(20) NOT NULL DEFAULT express' UNION ALL
  SELECT 'inventory_containers', 'location_id', 'BIGINT UNSIGNED nullable' UNION ALL
  SELECT 'inventory_containers', 'locked_by_task_id', 'BIGINT UNSIGNED nullable' UNION ALL
  SELECT 'inventory_containers', 'locked_at', 'DATETIME nullable' UNION ALL
  SELECT 'product_items', 'cost_price', 'DECIMAL(12,4) NOT NULL DEFAULT 0' UNION ALL
  SELECT 'picking_waves', 'priority', 'TINYINT UNSIGNED NOT NULL DEFAULT 2' UNION ALL
  SELECT 'warehouse_tasks', 'sorting_bin_id', 'BIGINT UNSIGNED nullable' UNION ALL
  SELECT 'warehouse_tasks', 'sorting_bin_code', 'VARCHAR(20) nullable'
) expected
LEFT JOIN (
  SELECT
    TABLE_NAME AS table_name,
    COLUMN_NAME AS column_name,
    CONCAT(
      COLUMN_TYPE,
      ' ',
      IF(IS_NULLABLE = 'NO', 'NOT NULL', 'NULL'),
      ' default=', COALESCE(COLUMN_DEFAULT, '<null>'),
      IF(EXTRA = '', '', CONCAT(' extra=', EXTRA))
    ) AS actual_definition
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
) actual
  ON actual.table_name = expected.table_name
 AND actual.column_name = expected.column_name
ORDER BY check_item;

SELECT
  '078_indexes' AS check_area,
  CONCAT(expected.table_name, '.', expected.index_name) AS check_item,
  expected.expected_columns,
  COALESCE(actual.actual_columns, '<missing>') AS actual_columns,
  IF(actual.index_name IS NULL, 'FAIL', IF(actual.actual_columns = expected.expected_columns, 'PASS', 'FAIL')) AS result
FROM (
  SELECT 'inventory_containers' table_name, 'idx_container_location' index_name, 'location_id' expected_columns UNION ALL
  SELECT 'inventory_containers', 'idx_container_locked', 'locked_by_task_id'
) expected
LEFT JOIN (
  SELECT
    TABLE_NAME AS table_name,
    INDEX_NAME AS index_name,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS actual_columns
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
  GROUP BY TABLE_NAME, INDEX_NAME
) actual
  ON actual.table_name = expected.table_name
 AND actual.index_name = expected.index_name
ORDER BY check_item;

SET @db_migrations_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'db_migrations'
);

SET @sql := IF(
  @db_migrations_exists = 1,
  'SELECT ''db_migrations'' AS check_area, expected.filename AS check_item, ''executed'' AS expected_state, IF(m.filename IS NULL, ''<missing>'', ''executed'') AS actual_state, IF(m.filename IS NULL, ''FAIL'', ''PASS'') AS result FROM (SELECT ''078_formalize_runtime_additive_schema.sql'' AS filename UNION ALL SELECT ''079_seed_default_print_templates.sql'') expected LEFT JOIN db_migrations m ON m.filename = expected.filename ORDER BY expected.filename',
  'SELECT ''db_migrations'' AS check_area, ''db_migrations table'' AS check_item, ''exists'' AS expected_state, ''<missing>'' AS actual_state, ''FAIL'' AS result'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @print_templates_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'print_templates'
);

SET @sql := IF(
  @print_templates_exists = 1,
  'SELECT ''079_print_templates'' AS check_area, CONCAT(expected.type, CHAR(58), expected.name) AS check_item, ''exists'' AS expected_state, IF(t.id IS NULL, ''<missing>'', CONCAT(''id='', t.id)) AS actual_state, IF(t.id IS NULL, ''FAIL'', ''PASS'') AS result FROM (SELECT 1 AS type, ''默认销售订单模板'' AS name UNION ALL SELECT 5, ''默认货架条码标签模板'' UNION ALL SELECT 6, ''默认库存条码标签模板'' UNION ALL SELECT 7, ''默认物流条码标签模板'' UNION ALL SELECT 8, ''默认产品条码标签模板'' UNION ALL SELECT 9, ''默认库存标签模板'') expected LEFT JOIN print_templates t ON t.type = expected.type AND t.name = expected.name ORDER BY expected.type',
  'SELECT ''079_print_templates'' AS check_area, ''print_templates table'' AS check_item, ''exists'' AS expected_state, ''<missing>'' AS actual_state, ''FAIL'' AS result'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
