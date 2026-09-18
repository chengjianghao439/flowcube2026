-- 2026-09-18 审计 P2-45：迁移 212 给 carriers / warehouse_locations 加的 active_unique_guard
-- 是**普通列**（NOT NULL DEFAULT 1 + 一次性回填），而全仓没有任何应用代码维护它。
-- 于是「软删后同码重建」并没有被修好：软删一行时 guard 仍是 1，唯一键
-- uk_carrier_code(code, active_unique_guard) / uk_location_code(code, active_unique_guard)
-- 仍然占着那个编码，再建同码直接 ER_DUP_ENTRY，而前端把它显示成「数据已存在，请勿重复提交」，
-- 与真实原因（编码被软删行占用）完全无关。
--
-- 正确模板是**生成列**（见 001_create_sys_users.sql:16 与 075:96）：
--   active_unique_guard TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED
-- 生成列由 deleted_at 自动推导，不依赖任何应用代码；MySQL 的唯一键把 NULL 视为互不相同，
-- 因此软删行可以有多条同码，而活跃行仍然唯一。
--
-- 本迁移不回改已执行的 212（AGENTS 第 5 节：已执行迁移只能新增、不能修改），只做改型。
-- 幂等：已是生成列则不动。
--
-- 注意：**不要**在改型前先 `UPDATE ... = NULL` 预处理存量值——旧列是 `NOT NULL DEFAULT 1`，
-- 把软删行改成 NULL 会直接报 `Column 'active_unique_guard' cannot be null`（本迁移第一版
-- 就踩了这个坑：测试库没有软删行所以「通过」，在真实库上才炸）。而且那一步本来就多余：
-- 列随后会被 DROP，旧值一律丢弃，新增的生成列由 MySQL 按 deleted_at 自行计算；
-- 软删行算出的 NULL 在唯一键里互不相同，不会冲突。

SET @db = DATABASE();

-- ── carriers ────────────────────────────────────────────────────────────────
SET @isGenerated = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'carriers'
     AND COLUMN_NAME = 'active_unique_guard' AND GENERATION_EXPRESSION <> ''
);
SET @sql = IF(@isGenerated = 0,
  'ALTER TABLE carriers DROP INDEX uk_carrier_code, DROP COLUMN active_unique_guard',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(@isGenerated = 0,
  'ALTER TABLE carriers ADD COLUMN active_unique_guard TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED, ADD UNIQUE KEY uk_carrier_code (code, active_unique_guard)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── warehouse_locations ─────────────────────────────────────────────────────
SET @isGenerated = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'warehouse_locations'
     AND COLUMN_NAME = 'active_unique_guard' AND GENERATION_EXPRESSION <> ''
);
SET @sql = IF(@isGenerated = 0,
  'ALTER TABLE warehouse_locations DROP INDEX uk_location_code, DROP COLUMN active_unique_guard',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(@isGenerated = 0,
  'ALTER TABLE warehouse_locations ADD COLUMN active_unique_guard TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED, ADD UNIQUE KEY uk_location_code (code, active_unique_guard)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
