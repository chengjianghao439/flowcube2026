-- 打印机来源：manual / client / local_desktop（历史 client 来自已移除的独立打印客户端；桌面端添加为 local_desktop）
-- 原文件是裸 ALTER，若库中已有 `source` 列会直接报错（曾要求人工跳过）。
-- 已改为 information_schema 幂等护栏（审计 4.10）：列已存在则跳过，保证任意库可重复执行。
SET @has_source := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'printers'
    AND COLUMN_NAME = 'source'
);
SET @sql := IF(@has_source = 0,
  'ALTER TABLE `printers` ADD COLUMN `source` VARCHAR(32) DEFAULT NULL COMMENT ''manual/client/local_desktop'' AFTER `description`',
  'SELECT "printers.source already exists" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
