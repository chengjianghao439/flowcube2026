-- FlowCube ERP - Migration 173
-- 采购计划明细（文档 11）。每个 商品×仓库 一行，生成时的预测/供给/建议量全部快照落库
-- （事后库存变了不追改，同 sale_order_items.cost_snapshot 的道理）。附商品/仓库/供应商名称快照，
-- 详情展示与转采购分组免再 JOIN 主数据。

CREATE TABLE IF NOT EXISTS `procurement_plan_items` (
  `id`             BIGINT NOT NULL AUTO_INCREMENT,
  `plan_id`        BIGINT NOT NULL,
  `product_id`     BIGINT NOT NULL,
  `warehouse_id`   BIGINT NOT NULL,
  `product_code`   VARCHAR(64)  NULL,
  `product_name`   VARCHAR(255) NULL,
  `unit`           VARCHAR(32)  NULL,
  `warehouse_name` VARCHAR(128) NULL,
  `supplier_id`    BIGINT       NULL COMMENT '建议/选定供应商，可空（采购员在明细页补选）',
  `supplier_name`  VARCHAR(128) NULL,
  -- 生成时快照（只读展示，不参与后续判定）
  `adu`            DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '预测日均需求 = 近N天出库/N',
  `forecast_demand` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '毛需求 = adu×(提前期+覆盖周期)',
  `safety_stock`   DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '安全库存快照（取自 product_stock_policies）',
  `available`      DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '可用量快照 = GREATEST(0, quantity-reserved)',
  `in_transit`     DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '在途采购快照',
  `lead_time_days` INT           NOT NULL DEFAULT 0 COMMENT '本行采用的提前期快照',
  -- 建议与决策
  `suggested_qty`  DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '系统建议采购量 = GREATEST(0, 毛需求+安全库存-可用-在途)',
  `adjusted_qty`   DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '采购员调整后数量，默认=suggested_qty',
  `expected_arrival` DATE        NULL COMMENT '建议到货日 = 今天 + 提前期',
  `status`         TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '1待处理 2已转采购 3已忽略',
  `purchase_order_id` BIGINT     NULL COMMENT '转采购后回填的采购单 id',
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_plan_product_wh` (`plan_id`,`product_id`,`warehouse_id`),
  KEY `idx_plan` (`plan_id`),
  KEY `idx_product_wh` (`product_id`,`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购计划明细（商品×仓库，全快照）';
