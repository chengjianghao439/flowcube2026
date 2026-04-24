-- 075: 修复软删除活跃唯一性 + print_jobs 数据库级幂等约束
-- 目标：
-- 1) 不再依赖 (business_key, deleted_at) 这种在 MySQL 中对 NULL 无效的唯一键
-- 2) print_jobs 并发创建时由数据库唯一约束兜底，而不是只靠先查再插

-- 迁移前脏数据校验：若存在重复活跃编码/账号，或存在重复活跃打印幂等任务，先中止迁移
SET @dup_sys_users := (
  SELECT COUNT(*)
  FROM (
    SELECT username
    FROM sys_users
    WHERE deleted_at IS NULL
    GROUP BY username
    HAVING COUNT(*) > 1
  ) t
);
SET @abort_sql := IF(
  @dup_sys_users = 0,
  'SELECT 1',
  'SELECT * FROM `__flowcube_migration_075_cleanup_required_active_sys_users__`'
);
PREPARE stmt FROM @abort_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @dup_inventory_warehouses := (
  SELECT COUNT(*)
  FROM (
    SELECT code
    FROM inventory_warehouses
    WHERE deleted_at IS NULL
    GROUP BY code
    HAVING COUNT(*) > 1
  ) t
);
SET @abort_sql := IF(
  @dup_inventory_warehouses = 0,
  'SELECT 1',
  'SELECT * FROM `__flowcube_migration_075_cleanup_required_active_inventory_warehouses__`'
);
PREPARE stmt FROM @abort_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @dup_sale_customers := (
  SELECT COUNT(*)
  FROM (
    SELECT code
    FROM sale_customers
    WHERE deleted_at IS NULL
    GROUP BY code
    HAVING COUNT(*) > 1
  ) t
);
SET @abort_sql := IF(
  @dup_sale_customers = 0,
  'SELECT 1',
  'SELECT * FROM `__flowcube_migration_075_cleanup_required_active_sale_customers__`'
);
PREPARE stmt FROM @abort_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @dup_print_jobs := (
  SELECT COUNT(*)
  FROM (
    SELECT
      job_unique_key,
      COALESCE(warehouse_id, 0) AS warehouse_scope,
      COALESCE(job_type, '') AS job_type_scope
    FROM print_jobs
    WHERE job_unique_key IS NOT NULL
      AND status IN (0, 1, 2)
    GROUP BY job_unique_key, warehouse_scope, job_type_scope
    HAVING COUNT(*) > 1
  ) t
);
SET @abort_sql := IF(
  @dup_print_jobs = 0,
  'SELECT 1',
  'SELECT * FROM `__flowcube_migration_075_cleanup_required_print_jobs_idem_scope__`'
);
PREPARE stmt FROM @abort_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE `sys_users`
  ADD COLUMN IF NOT EXISTS `active_unique_guard` TINYINT
    GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END) STORED
    COMMENT '活跃唯一性保护列：活跃=1，删除=NULL' AFTER `deleted_at`;

ALTER TABLE `inventory_warehouses`
  ADD COLUMN IF NOT EXISTS `active_unique_guard` TINYINT
    GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END) STORED
    COMMENT '活跃唯一性保护列：活跃=1，删除=NULL' AFTER `deleted_at`;

ALTER TABLE `sale_customers`
  ADD COLUMN IF NOT EXISTS `active_unique_guard` TINYINT
    GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END) STORED
    COMMENT '活跃唯一性保护列：活跃=1，删除=NULL' AFTER `deleted_at`;

ALTER TABLE `print_jobs`
  ADD COLUMN IF NOT EXISTS `idem_scope_warehouse_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (COALESCE(`warehouse_id`, 0)) STORED
    COMMENT '打印幂等范围：仓库空值归一到 0' AFTER `warehouse_id`,
  ADD COLUMN IF NOT EXISTS `idem_scope_job_type_key` VARCHAR(50)
    GENERATED ALWAYS AS (COALESCE(`job_type`, '')) STORED
    COMMENT '打印幂等范围：job_type 空值归一到空串' AFTER `job_type`,
  ADD COLUMN IF NOT EXISTS `idem_scope_live_guard` TINYINT
    GENERATED ALWAYS AS (
      CASE
        WHEN `job_unique_key` IS NOT NULL AND `status` IN (0, 1, 2) THEN 1
        ELSE NULL
      END
    ) STORED
    COMMENT '打印幂等保护列：待打/打印中/完成=1，失败=NULL' AFTER `status`;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sys_users'
    AND index_name = 'uk_sys_users_username_active'
);
SET @ddl_sql := IF(
  @idx_exists = 0,
  'ALTER TABLE `sys_users` ADD UNIQUE KEY `uk_sys_users_username_active` (`username`, `active_unique_guard`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'inventory_warehouses'
    AND index_name = 'uk_inventory_warehouses_code_active'
);
SET @ddl_sql := IF(
  @idx_exists = 0,
  'ALTER TABLE `inventory_warehouses` ADD UNIQUE KEY `uk_inventory_warehouses_code_active` (`code`, `active_unique_guard`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sale_customers'
    AND index_name = 'uk_sale_customers_code_active'
);
SET @ddl_sql := IF(
  @idx_exists = 0,
  'ALTER TABLE `sale_customers` ADD UNIQUE KEY `uk_sale_customers_code_active` (`code`, `active_unique_guard`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'print_jobs'
    AND index_name = 'uk_print_jobs_idem_scope_live'
);
SET @ddl_sql := IF(
  @idx_exists = 0,
  'ALTER TABLE `print_jobs` ADD UNIQUE KEY `uk_print_jobs_idem_scope_live` (`job_unique_key`, `idem_scope_warehouse_key`, `idem_scope_job_type_key`, `idem_scope_live_guard`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sys_users'
    AND index_name = 'uk_username'
);
SET @ddl_sql := IF(
  @idx_exists = 1,
  'ALTER TABLE `sys_users` DROP INDEX `uk_username`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'inventory_warehouses'
    AND index_name = 'uk_code'
);
SET @ddl_sql := IF(
  @idx_exists = 1,
  'ALTER TABLE `inventory_warehouses` DROP INDEX `uk_code`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sale_customers'
    AND index_name = 'uk_code'
);
SET @ddl_sql := IF(
  @idx_exists = 1,
  'ALTER TABLE `sale_customers` DROP INDEX `uk_code`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
