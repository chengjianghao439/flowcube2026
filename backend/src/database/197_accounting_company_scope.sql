-- FlowCube ERP - Migration 197
-- 多账套字段预留（P2-11）：acct_* 加 company_id，默认 1（当前单账套），
-- 未来多账套时按 company_id 隔离。现有查询默认 WHERE company_id=1 即保持现状。

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_accounts' AND COLUMN_NAME='company_id') = 0,
  'ALTER TABLE `acct_accounts` ADD COLUMN `company_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT ''所属账套（多账套预留，默认1）'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_vouchers' AND COLUMN_NAME='company_id') = 0,
  'ALTER TABLE `acct_vouchers` ADD COLUMN `company_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT ''所属账套（多账套预留，默认1）'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_voucher_entries' AND COLUMN_NAME='company_id') = 0,
  'ALTER TABLE `acct_voucher_entries` ADD COLUMN `company_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT ''所属账套（多账套预留，默认1）'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_periods' AND COLUMN_NAME='company_id') = 0,
  'ALTER TABLE `acct_periods` ADD COLUMN `company_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT ''所属账套（多账套预留，默认1）'' AFTER `period`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
