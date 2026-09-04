-- 来源重算保留修订链：根凭证继续持有唯一(company_id,source_type,source_id)，
-- 自动反冲与后继正向凭证以 source_root_id 指向根；source_id=NULL 避免覆盖历史。
-- 人工冲销不设置 source_root_id，从而明确区分人工停止记账与自动来源修订。
SET @has_source_root = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='acct_vouchers' AND COLUMN_NAME='source_root_id');
SET @sql = IF(@has_source_root=0,
  'ALTER TABLE acct_vouchers ADD COLUMN source_root_id BIGINT UNSIGNED DEFAULT NULL COMMENT ''自动来源修订的根凭证id；人工冲销为空'', ADD KEY idx_acct_vouchers_source_root (source_root_id,is_reversal,id)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
