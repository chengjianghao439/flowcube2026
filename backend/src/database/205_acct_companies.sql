-- FlowCube ERP - Migration 205
-- 会计账套（文档10 完整会计准则 · 多账套地基）。
--
-- 背景：197 迁移只给 acct_accounts/acct_vouchers/acct_voucher_entries/acct_periods 加了
-- company_id DEFAULT 1 列，但无 companies 主数据表、所有 SQL 未按 company_id 过滤（隐式单账套）。
-- 本迁移补上账套主数据，并把核心唯一键改为 (company_id, ...) 维度，让多账套真正隔离。
--
-- 默认账套 id=1（对应现有全部数据）；后续账套建账时自动复制预置科目。

CREATE TABLE IF NOT EXISTS `acct_companies` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`          VARCHAR(20)     NOT NULL COMMENT '账套编码',
  `name`          VARCHAR(100)    NOT NULL COMMENT '账套名称',
  `tax_no`        VARCHAR(30)     DEFAULT NULL COMMENT '纳税人识别号（报税用）',
  `parent_id`     BIGINT UNSIGNED DEFAULT NULL COMMENT '上级账套（合并报表母公司）',
  `is_group`      TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1集团/合并根账套',
  `currency`      VARCHAR(10)     NOT NULL DEFAULT 'CNY' COMMENT '记账本位币（除多币种，恒 CNY）',
  `start_period`  CHAR(6)         DEFAULT NULL COMMENT '启用会计期间 YYYYMM',
  `is_active`     TINYINT(1)      NOT NULL DEFAULT 1,
  `remark`        VARCHAR(300)    DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_acct_companies_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会计账套';

-- 默认账套（现有数据全部归它）
INSERT IGNORE INTO `acct_companies` (`id`, `code`, `name`, `currency`, `is_active`) VALUES (1, 'MAIN', '主账套', 'CNY', 1);

-- ── 唯一键改造为 (company_id, ...) 维度 ──
-- 用 information_schema 护栏幂等：键不存在才 drop/重建。
-- acct_accounts.code → (company_id, code)
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_accounts' AND INDEX_NAME='uk_acct_accounts_code_company');
SET @sql := IF(@has = 0,
  'ALTER TABLE `acct_accounts`
     DROP INDEX `uk_acct_accounts_code`,
     ADD UNIQUE KEY `uk_acct_accounts_code_company` (`company_id`, `code`)',
  'SELECT "acct_accounts idx already company-scoped" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- acct_vouchers.voucher_no → (company_id, voucher_no)
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_vouchers' AND INDEX_NAME='uk_acct_vouchers_no_company');
SET @sql := IF(@has = 0,
  'ALTER TABLE `acct_vouchers`
     DROP INDEX `uk_acct_vouchers_no`,
     ADD UNIQUE KEY `uk_acct_vouchers_no_company` (`company_id`, `voucher_no`)',
  'SELECT "acct_vouchers no idx already company-scoped" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- acct_vouchers.source (source_type,source_id) → (company_id, source_type, source_id) 幂等核心
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_vouchers' AND INDEX_NAME='uk_acct_vouchers_source_company');
SET @sql := IF(@has = 0,
  'ALTER TABLE `acct_vouchers`
     DROP INDEX `uk_acct_vouchers_source`,
     ADD UNIQUE KEY `uk_acct_vouchers_source_company` (`company_id`, `source_type`, `source_id`)',
  'SELECT "acct_vouchers source idx already company-scoped" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- acct_periods：先加 company_id 列（197 未覆盖本表），再改主键 → (company_id, period)
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_periods' AND COLUMN_NAME='company_id');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE `acct_periods` ADD COLUMN `company_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `period`',
  'SELECT "acct_periods.company_id exists" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_periods' AND INDEX_NAME='PRIMARY' AND COLUMN_NAME='company_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE `acct_periods` DROP PRIMARY KEY, ADD PRIMARY KEY (`company_id`, `period`)',
  'SELECT "acct_periods pk already company-scoped" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
