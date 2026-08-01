-- FlowCube ERP - Migration 184
-- 来料质检拒收处置（文档 07 · Phase 2）。
-- 背景：Phase 1 把质检不合格量分流到 REJECTED(6) 容器后即成静止死库存，无任何后续出口。
-- 本期给它补上「一键处置」——退供应商 / 报废，两者都只消费 REJECTED 容器（6→VOID）。
--
-- 关键会计口径（务必理解，勿"顺手"改成冲应付）：
--   拒收量在收货时就被隔离在 inventory_stock 与应付之外（Phase 1 设计 §5.4：rejected_qty 永不
--   进 putaway_qty，故 SUM(putaway×单价) 结算天然不含它；REJECTED 容器 status≠1 不计入库存缓存）。
--   因此处置这批「从未入账、从未计库存」的货，**零 GL 影响、零库存缓存影响、不生成任何凭证**。
--   total_amount / unit_price 仅为「参考货值」（拒收量×采购单价），供统计与对供应商索赔参考，**不是入账金额**，
--   voucher-engine 不认识本表、不会为它出凭证。设计文档 §9 那句"冲减应付由 syncPurchaseReturnShipped 完成"
--   与其自身 Phase 1 设计自相矛盾，是文档笔误，本实现按会计正确口径落地。

CREATE TABLE IF NOT EXISTS `inbound_qa_dispositions` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `disposition_no`     VARCHAR(30)     NOT NULL              COMMENT '处置单号 QAD20260802001',
  `inbound_task_id`    BIGINT UNSIGNED NOT NULL              COMMENT '来源收货订单ID',
  `inbound_task_no`    VARCHAR(30)     DEFAULT NULL          COMMENT '来源收货订单号',
  `purchase_order_id`  BIGINT UNSIGNED DEFAULT NULL          COMMENT '关联采购单ID（收货订单必挂PO，冗余便于报表）',
  `purchase_order_no`  VARCHAR(30)     DEFAULT NULL          COMMENT '关联采购单号',
  `supplier_id`        BIGINT UNSIGNED DEFAULT NULL          COMMENT '供应商ID（自采购单带出，退供应商索赔用）',
  `supplier_name`      VARCHAR(100)    DEFAULT NULL          COMMENT '供应商名称快照',
  `warehouse_id`       BIGINT UNSIGNED NOT NULL              COMMENT '所属仓库',
  `warehouse_name`     VARCHAR(100)    DEFAULT NULL          COMMENT '仓库名称快照',
  `disposition_type`   TINYINT(1)      NOT NULL              COMMENT '处置方式 1=退供应商 2=报废',
  `total_qty`          DECIMAL(14,4)   NOT NULL DEFAULT 0    COMMENT '处置总量（=消费的REJECTED容器remaining合计）',
  `total_amount`       DECIMAL(14,4)   NOT NULL DEFAULT 0    COMMENT '参考货值=拒收量×采购单价，仅统计用，非入账金额',
  `container_count`    INT             NOT NULL DEFAULT 0    COMMENT '消费的REJECTED容器数',
  `reason`             VARCHAR(200)    DEFAULT NULL          COMMENT '处置原因/质量问题描述',
  `remark`             VARCHAR(200)    DEFAULT NULL,
  `operator_id`        BIGINT UNSIGNED DEFAULT NULL          COMMENT '处置人',
  `operator_name`      VARCHAR(50)     DEFAULT NULL,
  `deleted_at`         DATETIME        DEFAULT NULL,
  `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qa_disposition_no` (`disposition_no`),
  INDEX `idx_qa_dispo_task` (`inbound_task_id`),
  INDEX `idx_qa_dispo_supplier` (`supplier_id`),
  INDEX `idx_qa_dispo_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='来料质检拒收处置单（退供应商/报废）';

CREATE TABLE IF NOT EXISTS `inbound_qa_disposition_items` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `disposition_id`        BIGINT UNSIGNED NOT NULL              COMMENT '处置单ID',
  `inbound_task_item_id`  BIGINT UNSIGNED DEFAULT NULL          COMMENT '来源收货明细行ID',
  `product_id`            BIGINT UNSIGNED NOT NULL,
  `product_code`          VARCHAR(30)     DEFAULT NULL,
  `product_name`          VARCHAR(100)    NOT NULL,
  `unit`                  VARCHAR(20)     DEFAULT NULL,
  `quantity`              DECIMAL(14,4)   NOT NULL DEFAULT 0    COMMENT '该商品处置量',
  `unit_price`            DECIMAL(12,4)   NOT NULL DEFAULT 0    COMMENT '采购单价快照（参考货值用，非入账）',
  `amount`                DECIMAL(14,4)   NOT NULL DEFAULT 0    COMMENT 'quantity×unit_price（参考）',
  `container_count`       INT             NOT NULL DEFAULT 0    COMMENT '该商品消费的REJECTED容器数',
  `created_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_qa_dispo_item_dispo` (`disposition_id`),
  INDEX `idx_qa_dispo_item_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='来料质检拒收处置单明细';
