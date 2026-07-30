-- FlowCube ERP - Migration 166
-- 运费对账（文档 06 · Phase 4）。
--
-- 把承运商回传/人工导入的实际运费按"承运商 + 账期"归集，生成对承运商的应付。
-- 两张表：明细 logistics_freight_bills（一条运单/一次称重一行）+ 汇总单头 logistics_freight_settlements。
--
-- 为什么要汇总单头：payment_records 有 UNIQUE(type, order_id)（091），运费没有采购/销售 order_id，
-- 不能把多条运费硬塞同一 order_id。以"承运商月结汇总单"为账款主体承接 order_id——
-- 一个承运商一个账期一张 settlement，生成时写一条 payment_records(type=1, order_id=settlement.id)。
--
-- 运费应付落点（硬约束）：只有 freight_type=1 寄付（我方付）才产生应付；2到付/3第三方付不计。
-- 生成应付接 settlement_type 快照与 confirm_status 财务确认闸门，不走裸 INSERT。

-- 运费对账明细
CREATE TABLE IF NOT EXISTS `logistics_freight_bills` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `carrier_id`    BIGINT UNSIGNED NOT NULL,
  `waybill_id`    BIGINT UNSIGNED DEFAULT NULL,
  `tracking_no`   VARCHAR(60)     DEFAULT NULL,
  `bill_period`   VARCHAR(7)      DEFAULT NULL COMMENT '账期 YYYY-MM',
  `actual_freight`DECIMAL(12,4)   NOT NULL DEFAULT 0 COMMENT '承运商回传实际运费',
  `weight`        DECIMAL(10,3)   DEFAULT NULL,
  `settlement_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归入的汇总单，NULL=未归集',
  `reconciled`    TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '0待核对 1已核对入应付',
  `source`        VARCHAR(20)     DEFAULT NULL COMMENT 'import 人工导入 / api 平台回传',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bill` (`carrier_id`,`tracking_no`),
  KEY `idx_period` (`carrier_id`,`bill_period`),
  KEY `idx_settlement` (`settlement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运费对账明细';

-- 运费月结汇总单（承运商应付的账款主体，承接 payment_records.order_id）
CREATE TABLE IF NOT EXISTS `logistics_freight_settlements` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `settlement_no`     VARCHAR(30)     NOT NULL COMMENT '汇总单号 FS+日期序列',
  `carrier_id`        BIGINT UNSIGNED NOT NULL,
  `carrier_name`      VARCHAR(100)    DEFAULT NULL COMMENT '承运商名快照',
  `bill_period`       VARCHAR(7)      NOT NULL COMMENT '账期 YYYY-MM',
  `total_freight`     DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '汇总运费（仅寄付计入）',
  `bill_count`        INT             NOT NULL DEFAULT 0 COMMENT '归集明细条数',
  `status`            TINYINT         NOT NULL DEFAULT 1 COMMENT '1草稿 2已生成应付',
  `payment_record_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '生成的应付记录 id',
  `created_by`        BIGINT UNSIGNED DEFAULT NULL,
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_settlement_no` (`settlement_no`),
  UNIQUE KEY `uk_carrier_period` (`carrier_id`,`bill_period`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运费月结汇总单';
