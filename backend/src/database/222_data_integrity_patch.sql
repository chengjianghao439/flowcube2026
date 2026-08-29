-- FlowCube ERP - Migration 222
-- 数据完整性补丁（2026-08-30 深度审计）：
--  1. payment_entries.payment_date 补索引：回款 KPI 按 payment_date BETWEEN 逐月查询（reports.query），
--     此前仅有 record_id/receipt_id/statement_id/account_id 四键，payment_date 全表扫。
--  2. price_change_requests.request_no 补唯一键：同批单据（disposal/refund/requisition/override/claim）
--     均有 request_no/单号唯一约束，唯改价单缺——少了数据库层防重号兜底。
--
-- 采用 information_schema 护栏（对照 205/210/218 范式），幂等可重入。

-- 1. payment_entries.payment_date 索引
SET @has_paydate_idx := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payment_entries'
    AND INDEX_NAME = 'idx_payment_entries_payment_date'
);
SET @sql := IF(@has_paydate_idx = 0,
  'ALTER TABLE `payment_entries` ADD KEY `idx_payment_entries_payment_date` (`payment_date`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. price_change_requests.request_no 唯一键
SET @has_pcr_uk := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'price_change_requests'
    AND INDEX_NAME = 'uk_pcr_request_no'
);
SET @sql := IF(@has_pcr_uk = 0,
  'ALTER TABLE `price_change_requests` ADD UNIQUE KEY `uk_pcr_request_no` (`request_no`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
