-- 2026-09-18 审计后续发现（比 P3-46 更严重）：生产库的 `payment_entries`
-- **既没有 `idx_payment_entries_record_id` 索引，也没有 `fk_payment_entries_record_id` 外键**，
-- 而迁移 054_create_payments_and_inventory_log_compat.sql 两者都声明了。
--
-- 成因：054 用的是 `CREATE TABLE IF NOT EXISTS`——payment_entries 由更早的迁移建过，
-- 于是整条 CREATE 被跳过，**连同其中的索引与外键一起从未落地**。声明存在 ≠ 约束存在。
-- 表现：本地/测试库有该外键（因此也有索引），生产两者皆无；缺外键意味着 record_id
-- 可以指向不存在的账款而数据库不拦。
--
-- 前置核对（只读）：生产 `payment_entries` 0 行、0 条孤儿记录，因此补外键安全。
-- 若将来在有孤儿数据的库上执行，ALTER 会**直接失败**——这是刻意行为：宁可报错，
-- 也不要静默跳过或让脏数据带着新约束继续存在。
--
-- 幂等：外键已存在则什么都不做。索引由 250 负责（本迁移不重复添加）。

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_entries'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_records'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_entries'
       AND CONSTRAINT_NAME = 'fk_payment_entries_record_id' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'ALTER TABLE payment_entries ADD CONSTRAINT fk_payment_entries_record_id FOREIGN KEY (record_id) REFERENCES payment_records(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
