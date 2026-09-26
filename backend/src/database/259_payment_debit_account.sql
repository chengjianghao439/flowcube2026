-- 非单据应付的借方科目（2026-09-26 一致性审查 · 任务 3b）。
--
-- 背景：type=1 且 order_id IS NULL 的应付只有两个来源——承运商运费结算（logistics.freight.js）
-- 与手工录入应付（payments.service.js createManual）。它们此前没有任何凭证来源：勾稽的凭证侧
-- 白名单只有 purchase_settle/purchase_return，业务侧又限定 order_id IS NOT NULL，两侧一起把它们
-- 排除，于是勾稽三项**静默显示为平**，而账上实际漏了这笔负债（2026-09-26 审查发现）。
--
-- 处置：为这两类应付补凭证来源（freight_settle / manual_payable，见 constants/voucherSource.js），
-- 借方科目取自本列：
--   · 运费结算在对账时自动写入 6601 销售费用（业务方 2026-09-26 确认口径）；
--   · 手工应付由财务在录入时逐笔选择（须为启用的明细科目）。
-- 贷方恒为 2202 应付账款〔往来单位〕。
--
-- ⚠️ 历史记录**不自动回填**：现有行本列保持 NULL，凭证引擎遇 NULL 一律跳过、不猜科目、不补凭证，
--    由勾稽的「未入账应付」按待处理差异报出，人工确认后再走补录通道。
--    本迁移严禁附带 UPDATE 猜测历史科目——那会把「不知道」写成「知道」，比漏账更难发现。
--
-- 条件式 DDL：MySQL 8 的 ALTER TABLE **不支持** ADD COLUMN IF NOT EXISTS（那是 MariaDB 扩展），
-- 故按本仓惯例先查 information_schema 再动态执行（同 017_alter_inventory_containers/032）。
SET @dbname = DATABASE();
SET @tablename = 'payment_records';
SET @columnname = 'debit_account_code';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `payment_records` ADD COLUMN `debit_account_code` VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''非单据应付的借方科目；运费自动6601，手工由财务逐笔选择；NULL=历史未分类（凭证引擎跳过，不猜科目）'''
));
PREPARE addDebitAccountColumn FROM @preparedStatement;
EXECUTE addDebitAccountColumn;
DEALLOCATE PREPARE addDebitAccountColumn;
