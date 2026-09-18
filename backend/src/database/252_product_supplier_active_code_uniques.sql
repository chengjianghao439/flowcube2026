-- 252: 商品 / 供应商的「活跃编码唯一」在演化库上根本不存在（2026-09-18 审计 [16]）
--
-- 事实（已在**生产库**上核对，不是推断）：
--   004_create_products_and_suppliers.sql 用 `CREATE TABLE IF NOT EXISTS` 声明了裸唯一
--   `uk_product_code(code)` / `uk_supplier_code(code)`。但这两张表比迁移文件还早（手工建的表），
--   因此 `IF NOT EXISTS` 对它们**是空操作**，004 只是被记进了 db_migrations。
--   结果同一份代码在两种库上唯一性语义不同：
--     · 新库（CI / 全新安装）：只有裸唯一 `uk_product_code(code)` —— 软删后**同码无法重建**
--       （错误被前端显示成「数据已存在，请勿重复提交」，与真实原因无关，与 212/248 修掉的
--        carriers / warehouse_locations 是同一个错法）；
--     · 演化库（dev / 生产）：只有 `uk_code(code, deleted_at)` —— MySQL 里 NULL 互不相等，
--       活跃行（deleted_at IS NULL）等于**零约束**，同码活跃行可以共存。
--       生产实测 product_items / supply_suppliers 的索引确为 PRIMARY + uk_code(code,deleted_at)
--       （+uk_product_sku_code），`uk_product_code` 从不存在；同码活跃行当前为 0 条。
--   而 codeGenerator.js 的注释明写「由调用方的 UNIQUE 约束兜底防重」——两种库上兜底都不成立。
--
-- 本迁移把两条血脉收敛成同一种形状（不回改 004，遵守 AGENTS 第 5 节「已执行迁移只新增」）：
--   ① 有重复**活跃**编码就中止（照抄 075 的中止模板，fail-loud，绝不静默删数据）；
--   ② 丢掉历史遗留的两种唯一键：裸唯一（新库血脉）与 (code, deleted_at)（演化库血脉）——
--      后者对活跃行无效、只约束软删行，属 075 明确否定的写法；
--   ③ 加生成列 active_unique_guard（由 deleted_at 推导，软删行自动为 NULL）+
--      `uk_product_items_code_active(code, active_unique_guard)` /
--      `uk_supply_suppliers_code_active(code, active_unique_guard)`。
--      该索引最左列是 code，仍可服务 `WHERE code = ?` 的查询，因此丢掉的裸唯一不影响性能。
--   ④ 幂等：列/索引已存在就跳过；列存在但不是生成列（历史形态）则拆掉重建。

SET @db = DATABASE();

-- ── ① 中止闸门：重复活跃编码 ────────────────────────────────────────────────
SET @dup_product := (
  SELECT COUNT(*) FROM (
    SELECT code FROM product_items WHERE deleted_at IS NULL GROUP BY code HAVING COUNT(*) > 1
  ) t
);
SET @dup_supplier := (
  SELECT COUNT(*) FROM (
    SELECT code FROM supply_suppliers WHERE deleted_at IS NULL GROUP BY code HAVING COUNT(*) > 1
  ) t
);
SET @abort_sql := IF(
  @dup_product + @dup_supplier = 0,
  'SELECT 1',
  'SELECT * FROM `__flowcube_migration_252_cleanup_required_active_product_code__`'
);
PREPARE stmt FROM @abort_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── ② 丢掉历史遗留唯一键（不存在则跳过）─────────────────────────────────────
SET @drop_product_bare := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'product_items' AND INDEX_NAME = 'uk_product_code') > 0,
  'ALTER TABLE product_items DROP INDEX uk_product_code', 'SELECT 1');
PREPARE stmt FROM @drop_product_bare; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_product_pair := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'product_items' AND INDEX_NAME = 'uk_code') > 0,
  'ALTER TABLE product_items DROP INDEX uk_code', 'SELECT 1');
PREPARE stmt FROM @drop_product_pair; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_supplier_bare := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'supply_suppliers' AND INDEX_NAME = 'uk_supplier_code') > 0,
  'ALTER TABLE supply_suppliers DROP INDEX uk_supplier_code', 'SELECT 1');
PREPARE stmt FROM @drop_supplier_bare; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_supplier_pair := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'supply_suppliers' AND INDEX_NAME = 'uk_code') > 0,
  'ALTER TABLE supply_suppliers DROP INDEX uk_code', 'SELECT 1');
PREPARE stmt FROM @drop_supplier_pair; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── ③ 重建为生成列 + 活跃唯一键 ─────────────────────────────────────────────

-- product_items
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'product_items' AND COLUMN_NAME = 'active_unique_guard');
SET @is_gen := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'product_items'
     AND COLUMN_NAME = 'active_unique_guard' AND GENERATION_EXPRESSION <> '');
-- 历史形态（普通列）先整块拆掉（连同它上面的唯一键，若在）
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'product_items' AND INDEX_NAME = 'uk_product_items_code_active');
SET @rebuild := IF(@has_col = 1 AND @is_gen = 0, 1, 0);
SET @sql := IF(@rebuild = 0, 'SELECT 1', IF(@has_idx = 1,
  'ALTER TABLE product_items DROP INDEX uk_product_items_code_active, DROP COLUMN active_unique_guard',
  'ALTER TABLE product_items DROP COLUMN active_unique_guard'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @need_create := IF(@has_col = 0 OR @rebuild = 1, 1, 0);
SET @sql := IF(@need_create = 1,
  'ALTER TABLE product_items ADD COLUMN active_unique_guard TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED, ADD UNIQUE KEY uk_product_items_code_active (code, active_unique_guard)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- supply_suppliers
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'supply_suppliers' AND COLUMN_NAME = 'active_unique_guard');
SET @is_gen := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'supply_suppliers'
     AND COLUMN_NAME = 'active_unique_guard' AND GENERATION_EXPRESSION <> '');
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'supply_suppliers' AND INDEX_NAME = 'uk_supply_suppliers_code_active');
SET @rebuild := IF(@has_col = 1 AND @is_gen = 0, 1, 0);
SET @sql := IF(@rebuild = 0, 'SELECT 1', IF(@has_idx = 1,
  'ALTER TABLE supply_suppliers DROP INDEX uk_supply_suppliers_code_active, DROP COLUMN active_unique_guard',
  'ALTER TABLE supply_suppliers DROP COLUMN active_unique_guard'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @need_create := IF(@has_col = 0 OR @rebuild = 1, 1, 0);
SET @sql := IF(@need_create = 1,
  'ALTER TABLE supply_suppliers ADD COLUMN active_unique_guard TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED, ADD UNIQUE KEY uk_supply_suppliers_code_active (code, active_unique_guard)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 订正 212 的错误结论（不能改已执行的文件，只能在此注明）：
--   212 断言「product_items / supply_suppliers 已是 (code, deleted_at) 复合唯一（NULL 不参与唯一），
--   等效 guard，无需改」——前半段与实测索引一致，但结论把 MySQL 的规则写反了：
--   唯一索引里 NULL 互不相等，所以 (code, deleted_at) 对活跃行（deleted_at IS NULL）**零约束**。
--   本迁移即为推翻该结论的落地修复。
