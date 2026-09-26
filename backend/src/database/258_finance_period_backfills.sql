-- 跨期补录留痕（2026-09-26 一致性审查 · 任务 7）。
--
-- 背景：会计期间结账（acct_periods.status=2）后，收付款/退款核销若仍把 payment_entries
-- 写进该期间，voucher-engine 会因期间已结账而跳过生凭证（stats.skippedClosed），
-- 结果是「钱动了、资金账户流水动了、会计账上却没有这笔」——账实不符且无人知晓。
--
-- 处置：这类写入默认 409 拒绝；持 finance.period.backfill 权限者可显式补录，
-- 但必须填写原因，且每一次补录都在本表留一行，供事后追溯「谁在什么时候把哪笔业务
-- 补进了哪个已结账期间、为什么」。
--
-- 本表只记录留痕，不参与任何业务计算，也不构成对账依据（对账看 payment_entries 与凭证）。
CREATE TABLE IF NOT EXISTS `finance_period_backfills` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL DEFAULT 1 COMMENT '账套 id',
  `period` char(6) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '被补录的已结账会计期间 YYYYMM',
  `business_date` date NOT NULL COMMENT '业务发生日期（决定落在哪个期间）',
  `biz_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务类型：payment 直付登记 / receipt 收付款单登记 / receipt_settle 核销 / refund 退款出账',
  `biz_id` bigint unsigned DEFAULT NULL COMMENT '业务单据 id（账款/收付款单/退款单）',
  `biz_no` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '业务单号，便于人工核对',
  `amount` decimal(14,4) DEFAULT NULL COMMENT '本次补录金额',
  `reason` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '补录原因（必填，操作人填写）',
  `operator_id` bigint unsigned DEFAULT NULL,
  `operator_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fpb_period` (`company_id`, `period`),
  KEY `idx_fpb_biz` (`biz_type`, `biz_id`),
  KEY `idx_fpb_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='已结账会计期间的跨期补录留痕';
