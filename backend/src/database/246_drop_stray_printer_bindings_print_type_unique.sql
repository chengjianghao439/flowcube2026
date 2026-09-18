-- 2026-09-18 审计后续发现：printer_bindings 上残留一条「只按 print_type」的全局唯一键。
--
-- 成因（逐条对迁移核过）：
--   · 034 建表时列定义写了 `print_type VARCHAR(50) NOT NULL UNIQUE`，MySQL 为此自动生成了一个
--     **名为 `print_type`** 的索引；同一迁移里又显式建了 `uk_print_type`。
--   · 044 想把「按用途全局唯一」改成「按仓库+用途唯一」，执行的是 `DROP INDEX uk_print_type`
--     —— 名字对不上，**034 自动生成的那条从未被删掉**。
--   · 于是 047（加 tenant_id 维度）与 069（单租户收敛回 uk_wh_print_type）的目标全部落空：
--     同一种 print_type 全局只能存在一条绑定，多仓绑同一用途的打印机直接 ER_DUP_ENTRY
--     （实测报错：Duplicate entry 'container_label' for key 'printer_bindings.print_type'）。
--
-- 本迁移删除这条残留索引，让「按 (warehouse_id, print_type) 唯一」真正生效——即恢复 044/047/069
-- 的本来意图，不是改变设计。幂等：索引不存在则什么都不做。

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'printer_bindings'
      AND INDEX_NAME = 'print_type' AND NON_UNIQUE = 0
  ),
  'ALTER TABLE printer_bindings DROP INDEX `print_type`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 保险：确认 (warehouse_id, print_type) 唯一键在位（069 之后应当已有，缺失则补建）
SET @sql = IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'printer_bindings' AND INDEX_NAME = 'uk_wh_print_type'
  ),
  'ALTER TABLE printer_bindings ADD UNIQUE KEY uk_wh_print_type (warehouse_id, print_type)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
