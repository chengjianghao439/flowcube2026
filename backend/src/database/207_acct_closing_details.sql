-- FlowCube ERP - Migration 207
-- 完整月末/年末结转链（文档10 完整会计准则 · 功能3）。
--
-- 补三件事：
--   ① acct_closing_details 结转快照表（可追溯「本张结转凭证由哪些科目汇总而来」）
--   ② 利润分配子科目 410401 提取法定盈余公积 / 410402 未分配利润（年结分步用）
--   ③ 6801 所得税费用（预埋给工资/报税功能用，进入损益结转自动纳入）

CREATE TABLE IF NOT EXISTS `acct_closing_details` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`    BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `period`        CHAR(6)         NOT NULL COMMENT '结转期间 YYYYMM',
  `closing_type`  VARCHAR(20)     NOT NULL COMMENT 'pl_month 月度损益 / year 年结 / profit_alloc 利润分配',
  `closing_voucher_id` BIGINT UNSIGNED NOT NULL COMMENT '对应结转凭证 id',
  `source_account_code` VARCHAR(20) NOT NULL COMMENT '来源科目',
  `source_account_name` VARCHAR(60) NOT NULL,
  `amount`        DECIMAL(16,2)   NOT NULL,
  `direction`     TINYINT         NOT NULL COMMENT '1借 2贷（在结转凭证中的方向）',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cd_voucher` (`closing_voucher_id`),
  KEY `idx_cd_period` (`company_id`, `period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='期末结转明细快照（可追溯）';

-- 利润分配子科目 + 所得税费用（与 voucherSource.js PRESET_ACCOUNTS 同步）
INSERT IGNORE INTO `acct_accounts` (`company_id`,`code`,`name`,`category`,`balance_dir`,`level`,`is_leaf`,`aux_type`,`is_preset`,`sort_order`) VALUES
  (1, '410401', '提取法定盈余公积', 3, 2, 2, 1, 0, 1, 141),
  (1, '410402', '未分配利润',      3, 2, 2, 1, 0, 1, 142),
  (1, '6801', '所得税费用',        6, 1, 1, 1, 0, 1, 186);
