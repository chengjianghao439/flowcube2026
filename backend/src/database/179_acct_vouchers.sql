-- FlowCube ERP - Migration 179
-- 记账凭证 + 凭证分录（文档 10 · Phase 1 凭证映射，设计 §4.2/§4.3）。
-- 凭证是业务事实的投影：由 modules/accounting/voucher-engine.js 从既有事实表（payment_records /
-- sale_order_items.cost_snapshot / payment_receipts / finance_account_transactions / 退货 / 盘点）
-- 全量重算生成，UNIQUE(source_type, source_id) 幂等；**只读业务表、只写 acct_*，绝不反向改业务事实**。
-- 借贷平衡由引擎入库前 assert（total_debit === total_credit），不平不入库。

CREATE TABLE IF NOT EXISTS `acct_vouchers` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `voucher_no`    VARCHAR(30)   NOT NULL              COMMENT '凭证号 记-YYYYMM-序号',
  `voucher_date`  DATE          NOT NULL              COMMENT '记账日期（取业务发生日，非生成日）',
  `period`        CHAR(6)       NOT NULL              COMMENT '会计期间 YYYYMM（由 voucher_date 派生，冗余便于按期查）',
  `source_type`   VARCHAR(40)   NOT NULL              COMMENT '业务来源类型，见 constants/voucherSource.js SOURCE_TYPES',
  `source_id`     BIGINT UNSIGNED DEFAULT NULL        COMMENT '来源业务单据 id（manual 为空）',
  `source_no`     VARCHAR(40)   DEFAULT NULL          COMMENT '来源业务单号快照',
  `summary`       VARCHAR(200)  DEFAULT NULL          COMMENT '凭证摘要',
  `total_debit`   DECIMAL(16,2) NOT NULL DEFAULT 0    COMMENT '借方合计',
  `total_credit`  DECIMAL(16,2) NOT NULL DEFAULT 0    COMMENT '贷方合计（必须等于借方，入库前 assert）',
  `status`        TINYINT       NOT NULL DEFAULT 1    COMMENT '1已生成 2已过账 3已冲销（本期只用 1/3）',
  `is_reversal`   TINYINT       NOT NULL DEFAULT 0    COMMENT '1本张是红字冲销凭证',
  `reversed_id`   BIGINT UNSIGNED DEFAULT NULL        COMMENT '被本张冲销的原凭证 id',
  `source_hash`   VARCHAR(64)   DEFAULT NULL          COMMENT '来源事实内容指纹，重算时判断是否需重生成',
  `created_by`    BIGINT UNSIGNED DEFAULT NULL,
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_acct_vouchers_no` (`voucher_no`),
  -- 幂等核心：同一业务事件只生成一张凭证；重放/重算命中即更新不新增（对齐 payment_records UNIQUE(type,order_id)）
  UNIQUE KEY `uk_acct_vouchers_source` (`source_type`, `source_id`),
  KEY `idx_acct_vouchers_period` (`period`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='记账凭证（文档10）';

CREATE TABLE IF NOT EXISTS `acct_voucher_entries` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `voucher_id`    BIGINT UNSIGNED NOT NULL,
  `line_no`       SMALLINT      NOT NULL              COMMENT '分录行号（凭证内排序）',
  `account_id`    BIGINT UNSIGNED NOT NULL,
  `account_code`  VARCHAR(20)   NOT NULL              COMMENT '科目编码快照（科目改名/改码不影响历史凭证）',
  `account_name`  VARCHAR(60)   NOT NULL              COMMENT '科目名称快照',
  `direction`     TINYINT       NOT NULL              COMMENT '1借 2贷',
  `amount`        DECIMAL(16,2) NOT NULL              COMMENT '金额（正数，方向由 direction 表达）',
  `summary`       VARCHAR(200)  DEFAULT NULL          COMMENT '分录摘要',
  `aux_type`      TINYINT       NOT NULL DEFAULT 0    COMMENT '辅助核算类型（同 acct_accounts.aux_type）',
  `aux_id`        BIGINT UNSIGNED DEFAULT NULL        COMMENT '辅助核算对象 id（往来单位 supplier_id/customer_id）',
  `aux_name`      VARCHAR(100)  DEFAULT NULL          COMMENT '辅助核算对象名称快照',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_acct_entries_voucher` (`voucher_id`),
  KEY `idx_acct_entries_account` (`account_id`, `direction`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='凭证分录（文档10）';
