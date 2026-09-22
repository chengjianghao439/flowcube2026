-- 销售来源按订单×实际出库期间投影；历史累计凭证保留空期间，不回写日期/金额。
SET @has_period = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_vouchers' AND COLUMN_NAME='source_period');
SET @sql = IF(@has_period=0,
  'ALTER TABLE acct_vouchers ADD COLUMN source_period CHAR(6) NOT NULL DEFAULT '''' COMMENT ''销售来源期间；历史累计及其他来源为空''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
-- 同名旧键按列顺序核对；换键与删除旧唯一键同一 DDL，避免中途失去幂等约束。
SET @columns = (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_vouchers'
    AND INDEX_NAME='uk_acct_vouchers_source_company');
SET @non_unique = (SELECT MIN(NON_UNIQUE) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_vouchers' AND INDEX_NAME='uk_acct_vouchers_source_company');
SET @sql = CASE
  WHEN @columns='company_id,source_type,source_id,source_period' AND @non_unique=0 THEN 'SELECT 1'
  WHEN @columns IS NULL THEN 'ALTER TABLE acct_vouchers ADD UNIQUE KEY uk_acct_vouchers_source_company(company_id,source_type,source_id,source_period)'
  ELSE 'ALTER TABLE acct_vouchers DROP INDEX uk_acct_vouchers_source_company, ADD UNIQUE KEY uk_acct_vouchers_source_company(company_id,source_type,source_id,source_period)'
END;
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
