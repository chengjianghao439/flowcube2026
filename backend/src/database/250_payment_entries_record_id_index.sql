-- 2026-09-18 审计 P3-46：`payment_entries.record_id` 缺索引，账款详情/付款明细的主查询路径全表扫描。
--
-- 事实核对（只读）：
--   · 迁移 054_create_payments_and_inventory_log_compat.sql:33 **确实声明了**
--     `KEY idx_payment_entries_record_id (record_id)`；
--   · 但**生产库上这条索引不存在**（实测 SHOW INDEX 只有 PRIMARY / receipt / statement /
--     account_id / payment_date），本地测试库反而有。
--   成因与 CLAUDE.md 记的「生产库存在 schema 漂移史」同源：054 用的是
--   `CREATE TABLE IF NOT EXISTS`，若 payment_entries 由更早的迁移建过，整条 CREATE 被跳过，
--   连同里面的索引一起从未落地——声明存在 ≠ 索引存在。
--
-- 本迁移按幂等条件 DDL 补齐该索引（已存在则什么都不做）；不回改 054。
-- 注意：这是**只加索引**，不改任何数据与列语义。

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_entries'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_entries'
       AND INDEX_NAME = 'idx_payment_entries_record_id'
  ),
  'ALTER TABLE payment_entries ADD INDEX idx_payment_entries_record_id (record_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
