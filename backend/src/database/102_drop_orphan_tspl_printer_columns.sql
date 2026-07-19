-- 清理孤儿列：054_printers_tspl_compat.sql 曾在 printers 表加了这三列，
-- 该迁移文件后来被删除（未随附回滚迁移），导致已执行过 054 的环境（本机/生产）
-- 残留这三列，而全新环境从 migrations 目录重建 schema 时不会再创建它们，产生漂移。
-- 代码库中已无任何地方引用这三个字段，此处统一 DROP，使 migrations 目录重新成为 schema 的唯一权威来源。
-- 沿用 088 的写法：用 information_schema 判断后动态执行，兼容 MySQL 8.0 且对全新库幂等安全。
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'printers'
    AND COLUMN_NAME = 'tspl_wire_encoding'
);
SET @ddl := IF(@col_exists > 0, 'ALTER TABLE `printers` DROP COLUMN `tspl_wire_encoding`', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'printers'
    AND COLUMN_NAME = 'tspl_line_ending'
);
SET @ddl := IF(@col_exists > 0, 'ALTER TABLE `printers` DROP COLUMN `tspl_line_ending`', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'printers'
    AND COLUMN_NAME = 'tspl_codepage_policy'
);
SET @ddl := IF(@col_exists > 0, 'ALTER TABLE `printers` DROP COLUMN `tspl_codepage_policy`', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
