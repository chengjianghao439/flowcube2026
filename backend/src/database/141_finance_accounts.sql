-- FlowCube ERP - Migration 141
-- 资金账户与账户流水：管理不同的收付款账户（银行/现金/支付宝/微信），
-- 让每一笔钱的进出都落到具体账户上，账户余额可查、可对。
--
-- 设计要点：
--   finance_account_transactions 是**唯一事实源**，finance_accounts.current_balance
--   只是它的投影——每次写流水后在同一事务里锁账户行重算（期初 + Σ收 − Σ支），
--   不做「读余额→加减→写回」的独立累加。inventory_stock 的缓存漂移事故就是这么来的
--   （见 CLAUDE.md 第 9 节），钱的账目更不能出这种事。
--
--   收款核销、付款核销、费用报销（第二期）都往这张流水表写，账户余额才完整。

CREATE TABLE IF NOT EXISTS `finance_accounts` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`            VARCHAR(30)     NOT NULL COMMENT '账户编码 ACC+序号',
  `name`            VARCHAR(80)     NOT NULL COMMENT '账户名称，如「工商银行基本户」',
  `type`            TINYINT         NOT NULL DEFAULT 1 COMMENT '1银行 2现金 3支付宝 4微信 5其他',
  `account_no`      VARCHAR(60)     DEFAULT NULL COMMENT '账号/卡号，现金账户可空',
  `bank_name`       VARCHAR(80)     DEFAULT NULL COMMENT '开户行',
  `holder`          VARCHAR(80)     DEFAULT NULL COMMENT '户名',
  `opening_balance` DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '期初余额（建档时的账面金额）',
  `current_balance` DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '当前余额＝期初＋流水，由 refreshBalance 重算，勿直接写',
  `is_active`       TINYINT         NOT NULL DEFAULT 1 COMMENT '1启用 0停用（停用后不可再选作收付款账户）',
  `sort_order`      INT             NOT NULL DEFAULT 0,
  `remark`          VARCHAR(300)    DEFAULT NULL,
  `operator_id`     BIGINT UNSIGNED DEFAULT NULL,
  `operator_name`   VARCHAR(50)     DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_finance_accounts_code` (`code`),
  KEY `idx_finance_accounts_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资金账户档案';

CREATE TABLE IF NOT EXISTS `finance_account_transactions` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id`    BIGINT UNSIGNED NOT NULL,
  `direction`     TINYINT         NOT NULL COMMENT '1收入（钱进来）2支出（钱出去）',
  `amount`        DECIMAL(16,4)   NOT NULL COMMENT '正数，方向由 direction 表达',
  `biz_type`      TINYINT         NOT NULL COMMENT '1收款 2付款 3费用报销 4余额调整',
  `biz_id`        BIGINT UNSIGNED DEFAULT NULL COMMENT '关联业务单据 id',
  `biz_no`        VARCHAR(30)     DEFAULT NULL COMMENT '关联业务单号，便于流水页直接看懂',
  `party_name`    VARCHAR(100)    DEFAULT NULL COMMENT '往来方，收付款时冗余一份便于查账',
  `balance_after` DECIMAL(16,4)   NOT NULL COMMENT '本笔之后的账户余额快照，用于逐笔核对',
  `happened_at`   DATE            NOT NULL COMMENT '资金实际发生日（汇款日/报销付款日）',
  `remark`        VARCHAR(300)    DEFAULT NULL,
  `operator_id`   BIGINT UNSIGNED DEFAULT NULL,
  `operator_name` VARCHAR(50)     DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fat_account_time` (`account_id`, `happened_at`, `id`),
  KEY `idx_fat_biz` (`biz_type`, `biz_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账户流水（资金进出的唯一事实源）';

-- 收付款单记录钱从哪个账户进出。历史汇款单留空不回填——当时没有账户概念，
-- 强行归到某个账户会凭空改变那个账户的余额。
ALTER TABLE `payment_receipts`
  ADD COLUMN `account_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '收付款账户；NULL 为迁移 141 之前的历史单' AFTER `method`,
  ADD KEY `idx_payment_receipts_account` (`account_id`);
