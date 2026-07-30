-- FlowCube ERP - Migration 152
-- 采购请购单（PR → 审批 → 转生成采购单）。补上采购链路缺失的「申请—审批」前置环节。
--
-- 背景：采购目前无任何审批环节，谁有建单权就能直接 confirm 成对供应商的正式承诺（v0.4.22
-- 移除收货人工审核后，采购全链路无控制点）。本功能引入请购单：一线/采购发起需求 → 一级审批
-- → 已批准后转生成采购单。审批范式完全复用费用报销 expenseClaim（状态机 + 加锁写法）。
--
-- 纯需求单据：请购**不碰库存、不进 payment_records**（同报销），实际供应商与价格在转单时定。
-- 状态：1草稿 2待审批 3已批准 4已驳回 5已取消 6已转采购(全部明细已生成 PO，终态)。
-- DDL 风格对齐 143_expense_claims.sql / 007_purchase_orders：BIGINT UNSIGNED 主键、单号 UNIQUE、
-- status TINYINT 带语义注释、明细存名称/单位/供应商名快照、逻辑删除 deleted_at。
CREATE TABLE IF NOT EXISTS `purchase_requisitions` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requisition_no`    VARCHAR(30)     NOT NULL COMMENT '请购单号 PR+日期+序号',
  `title`             VARCHAR(100)    DEFAULT NULL COMMENT '事由摘要',
  `warehouse_id`      BIGINT UNSIGNED NOT NULL COMMENT '期望入库仓（与 PO 头单仓对齐，转单时带入）',
  `warehouse_name`    VARCHAR(80)     NOT NULL,
  `applicant_id`      BIGINT UNSIGNED NOT NULL COMMENT '申请人（审批人不得为本人）',
  `applicant_name`    VARCHAR(50)     NOT NULL,
  `estimated_amount`  DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '预估金额(Σ 预估单价×数量)，仅参考，由 refreshTotal 重算',
  `status`            TINYINT         NOT NULL DEFAULT 1 COMMENT '1草稿 2待审批 3已批准 4已驳回 5已取消 6已转采购',
  `source`            VARCHAR(20)     NOT NULL DEFAULT 'manual' COMMENT '来源 manual/replenishment(补货建议)',
  `submitted_at`      DATETIME        DEFAULT NULL,
  `approved_by`       BIGINT UNSIGNED DEFAULT NULL,
  `approved_by_name`  VARCHAR(50)     DEFAULT NULL,
  `approved_at`       DATETIME        DEFAULT NULL,
  `reject_reason`     VARCHAR(300)    DEFAULT NULL,
  `expected_date`     DATE            DEFAULT NULL COMMENT '期望到货日，转单时带入 PO.expected_date',
  `remark`            VARCHAR(300)    DEFAULT NULL,
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_purchase_requisitions_no` (`requisition_no`),
  KEY `idx_pr_status` (`status`, `created_at`),
  KEY `idx_pr_applicant` (`applicant_id`),
  KEY `idx_pr_warehouse` (`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购请购单';

-- 请购明细：请购量 + 建议供应商（可空，转单按此分组）+ 已转采购量（分批转单累加）
CREATE TABLE IF NOT EXISTS `purchase_requisition_items` (
  `id`                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requisition_id`          BIGINT UNSIGNED NOT NULL,
  `product_id`              BIGINT UNSIGNED NOT NULL,
  `product_code`            VARCHAR(50)     NOT NULL COMMENT '快照',
  `product_name`            VARCHAR(150)    NOT NULL COMMENT '快照',
  `unit`                    VARCHAR(20)     NOT NULL COMMENT '快照',
  `spec`                    VARCHAR(200)    DEFAULT NULL,
  `quantity`                DECIMAL(18,4)   NOT NULL COMMENT '请购数量',
  `estimated_price`         DECIMAL(14,4)   DEFAULT NULL COMMENT '预估单价，可空；实际价在转单时定',
  `suggested_supplier_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '建议供应商，可空；转单按 supplier 分组拆 PO',
  `suggested_supplier_name` VARCHAR(100)    DEFAULT NULL,
  `converted_qty`           DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT '已转采购量（分批转单累加），仿 sale_order_items.dispatched 分批语义',
  `remark`                  VARCHAR(200)    DEFAULT NULL,
  `created_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pr_items_requisition` (`requisition_id`),
  KEY `idx_pr_items_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购请购明细';

-- 请购转采购单追溯：一张请购可分批、按供应商拆成多张 PO，逐笔记录哪个请购行转出多少到哪张 PO
CREATE TABLE IF NOT EXISTS `purchase_requisition_conversions` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requisition_id`      BIGINT UNSIGNED NOT NULL,
  `requisition_item_id` BIGINT UNSIGNED NOT NULL,
  `purchase_order_id`   BIGINT UNSIGNED NOT NULL,
  `quantity`            DECIMAL(18,4)   NOT NULL COMMENT '本次从该请购行转出的数量',
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_prc_requisition` (`requisition_id`),
  KEY `idx_prc_po` (`purchase_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='请购转采购单追溯';

-- 采购单加溯源列：记录该 PO 来自哪张请购单（可空，手工建单为 NULL）
ALTER TABLE `purchase_orders`
  ADD COLUMN `source_requisition_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '来源请购单ID（请购转单生成时回填，手工建单为空）';
