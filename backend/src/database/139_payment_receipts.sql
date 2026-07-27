-- FlowCube ERP - Migration 139
-- 收付款单与核销：支持「一笔汇款核销多个订单」。
--
-- 此前 payment_entries.record_id 单指向一笔账款，只能表达「某笔账款收到了多少钱」，
-- 无法表达「客户一次汇了 5 万，冲抵其中 3 张订单」——而这正是现实里最常见的收款方式。
--
-- 模型：
--   payment_receipts  一笔实际的汇款/付款（钱的来源），有自己的可核销余额
--   payment_entries   升级为核销明细：把一笔汇款拆分核销到若干笔账款
--                     （receipt_id 为 NULL 的是本迁移之前的单笔登记，保持原样可读）
--
-- 允许部分核销：汇款金额与订单合计不必相等。少付则订单留余额，多付则汇款单留可核销余额
-- 供下次继续使用（也就天然支持了预收款）。

CREATE TABLE IF NOT EXISTS `payment_receipts` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `receipt_no`     VARCHAR(30)     NOT NULL COMMENT '单号：应付 PY+日期+序号，应收 RC+日期+序号',
  `type`           TINYINT         NOT NULL COMMENT '1付款(对应应付) 2收款(对应应收)',
  `party_name`     VARCHAR(100)    NOT NULL COMMENT '往来方名称，与 payment_records.party_name 对齐',
  `amount`         DECIMAL(14,4)   NOT NULL COMMENT '本次汇款总额',
  `settled_amount` DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '已核销金额',
  `balance`        DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '剩余可核销 = amount - settled_amount',
  `status`         TINYINT         NOT NULL DEFAULT 1 COMMENT '1待核销 2部分核销 3已核销完',
  `payment_date`   DATE            NOT NULL COMMENT '汇款日期',
  `method`         VARCHAR(50)     DEFAULT NULL COMMENT '现金/转账/支票/网银/其他',
  `remark`         VARCHAR(300)    DEFAULT NULL,
  `operator_id`    BIGINT UNSIGNED DEFAULT NULL,
  `operator_name`  VARCHAR(50)     DEFAULT NULL,
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payment_receipts_no` (`receipt_no`),
  KEY `idx_payment_receipts_scope` (`type`, `status`, `payment_date`),
  KEY `idx_payment_receipts_party` (`party_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收付款单（汇款）与核销余额';

ALTER TABLE `payment_entries`
  ADD COLUMN `receipt_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '所属收付款单；NULL 表示迁移 139 之前的单笔登记' AFTER `record_id`,
  ADD KEY `idx_payment_entries_receipt` (`receipt_id`);
