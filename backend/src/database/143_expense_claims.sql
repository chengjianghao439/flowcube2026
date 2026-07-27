-- FlowCube ERP - Migration 143
-- 日常费用报销：登记经营费用（房租/水电/差旅/办公/招待…），一级审批后从资金账户付款。
--
-- 与往来账款的边界：
--   **报销不进 payment_records**。那张表是对供应商/客户的往来账款（债权债务），
--   报销是内部经营费用，性质不同；混在一起会污染应付应收的口径与账龄分析。
--   两者只在 finance_account_transactions（账户流水）层汇合——都是钱的进出。
--
-- 状态：1草稿 2待审批 3已批准 4已付款 5已驳回 6已取消
--   草稿 --submit--> 待审批 --approve--> 已批准 --pay--> 已付款
--                      |--reject--> 已驳回
--                      |--withdraw--> 草稿
--   已付款是终态：要冲销得走反向流水，不允许改单（改了账户流水就对不上）。

CREATE TABLE IF NOT EXISTS `expense_categories` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(30)     NOT NULL COMMENT '类别编码 EC+序号',
  `name`       VARCHAR(50)     NOT NULL COMMENT '类别名称，如「差旅费」',
  `is_active`  TINYINT         NOT NULL DEFAULT 1,
  `sort_order` INT             NOT NULL DEFAULT 0,
  `remark`     VARCHAR(200)    DEFAULT NULL,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_expense_categories_code` (`code`),
  KEY `idx_expense_categories_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='费用类别字典';

CREATE TABLE IF NOT EXISTS `expense_claims` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `claim_no`         VARCHAR(30)     NOT NULL COMMENT '报销单号 EX+日期+序号',
  `title`            VARCHAR(100)    DEFAULT NULL COMMENT '事由摘要',
  `applicant_id`     BIGINT UNSIGNED NOT NULL COMMENT '申请人（审批人不得为本人）',
  `applicant_name`   VARCHAR(50)     NOT NULL,
  `total_amount`     DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '明细金额之和，由 refreshTotal 重算',
  `status`           TINYINT         NOT NULL DEFAULT 1 COMMENT '1草稿 2待审批 3已批准 4已付款 5已驳回 6已取消',
  `submitted_at`     DATETIME        DEFAULT NULL,
  `approved_by`      BIGINT UNSIGNED DEFAULT NULL,
  `approved_by_name` VARCHAR(50)     DEFAULT NULL,
  `approved_at`      DATETIME        DEFAULT NULL,
  `reject_reason`    VARCHAR(300)    DEFAULT NULL,
  `paid_account_id`  BIGINT UNSIGNED DEFAULT NULL COMMENT '从哪个资金账户付出',
  `paid_at`          DATETIME        DEFAULT NULL,
  `paid_by_name`     VARCHAR(50)     DEFAULT NULL,
  `remark`           VARCHAR(300)    DEFAULT NULL,
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_expense_claims_no` (`claim_no`),
  KEY `idx_expense_claims_status` (`status`, `created_at`),
  KEY `idx_expense_claims_applicant` (`applicant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='费用报销单';

CREATE TABLE IF NOT EXISTS `expense_claim_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `claim_id`      BIGINT UNSIGNED NOT NULL,
  `category_id`   BIGINT UNSIGNED NOT NULL,
  `category_name` VARCHAR(50)     NOT NULL COMMENT '快照：类别改名不影响历史单据',
  `amount`        DECIMAL(14,4)   NOT NULL,
  `happened_at`   DATE            NOT NULL COMMENT '费用实际发生日',
  `description`   VARCHAR(200)    DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expense_items_claim` (`claim_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='费用报销明细';

-- 预置常用类别，开箱可用；不够用在「费用类别」页自行增删
INSERT INTO `expense_categories` (`code`, `name`, `sort_order`) VALUES
  ('EC000001', '办公费',   10),
  ('EC000002', '差旅费',   20),
  ('EC000003', '交通费',   30),
  ('EC000004', '业务招待费', 40),
  ('EC000005', '房租水电', 50),
  ('EC000006', '快递运费', 60),
  ('EC000007', '其他',     99);
