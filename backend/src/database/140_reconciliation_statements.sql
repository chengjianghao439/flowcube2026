-- FlowCube ERP - Migration 140
-- 汇总对账单：把一段期间内某往来方的多笔月结账款汇总成一张单，确认锁定后导出发对方核对，
-- 对方汇款后在收款核销中冲抵这张对账单。
--
-- 与账款、汇款单的关系：
--   reconciliation_statements       一张对账单（钱的口径：这段时间你一共欠我多少）
--   reconciliation_statement_items  这张单包含哪些 payment_records
--   payment_entries.statement_id    核销时标记「这笔冲抵是通过哪张对账单做的」
--
-- 核销仍然落到 payment_records 上（账款余额才是唯一事实），对账单的 settled_amount
-- 只是这些明细核销额的汇总投影——不能反过来让对账单成为余额的事实源。
--
-- 状态：1草稿（可增删明细）2已确认（锁定，可导出/核销）3已核销完。
-- 已确认可以解锁回草稿（业务上允许改），但**已经核销过的不允许解锁**，
-- 否则改完明细后账就对不上了——这条在 service 里强制。

CREATE TABLE IF NOT EXISTS `reconciliation_statements` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `statement_no`     VARCHAR(30)     NOT NULL COMMENT '单号：应付 SP+日期+序号，应收 SC+日期+序号',
  `type`             TINYINT         NOT NULL COMMENT '1供应商对账(应付) 2客户对账(应收)',
  `party_name`       VARCHAR(100)    NOT NULL COMMENT '往来方名称，与 payment_records.party_name 对齐',
  `period_start`     DATE            DEFAULT NULL COMMENT '对账期间起（按账款创建日）',
  `period_end`       DATE            DEFAULT NULL COMMENT '对账期间止',
  `total_amount`     DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '汇总金额 = 各明细账款总额之和',
  `settled_amount`   DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '已核销金额（明细核销额投影）',
  `balance`          DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '未核销 = total_amount - settled_amount',
  `status`           TINYINT         NOT NULL DEFAULT 1 COMMENT '1草稿 2已确认 3已核销完',
  `confirmed_by`     BIGINT UNSIGNED DEFAULT NULL,
  `confirmed_by_name` VARCHAR(50)    DEFAULT NULL,
  `confirmed_at`     DATETIME        DEFAULT NULL,
  `remark`           VARCHAR(300)    DEFAULT NULL,
  `operator_id`      BIGINT UNSIGNED DEFAULT NULL,
  `operator_name`    VARCHAR(50)     DEFAULT NULL,
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_recon_statements_no` (`statement_no`),
  KEY `idx_recon_statements_scope` (`type`, `status`, `created_at`),
  KEY `idx_recon_statements_party` (`party_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='汇总对账单';

CREATE TABLE IF NOT EXISTS `reconciliation_statement_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `statement_id`  BIGINT UNSIGNED NOT NULL,
  `record_id`     BIGINT UNSIGNED NOT NULL COMMENT '对应 payment_records.id',
  `order_no`      VARCHAR(30)     NOT NULL COMMENT '快照：关联单号',
  `total_amount`  DECIMAL(14,4)   NOT NULL COMMENT '快照：入单时该账款总额',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- 一笔账款只能进一张对账单，防止同一笔钱被对两次
  UNIQUE KEY `uk_recon_items_record` (`record_id`),
  KEY `idx_recon_items_statement` (`statement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对账单明细';

ALTER TABLE `payment_entries`
  ADD COLUMN `statement_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '经由哪张对账单核销；NULL=直接核销到账款' AFTER `receipt_id`,
  ADD KEY `idx_payment_entries_statement` (`statement_id`);
