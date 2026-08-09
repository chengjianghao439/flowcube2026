-- FlowCube ERP - Migration 199
-- 呆滞库存处置单（P2-9）：建议 → 审批 → 处置。
--
--   inventory_disposal_orders  处置单头
--   inventory_disposal_items   处置明细（商品 + 建议处置方式）
--
-- 状态机（documentStatusRules 的 inventoryDisposal）：
--   1 草稿 → 2 待审批 → 3 已批准 → 4 已处置 / 5 已驳回 / 6 已取消
-- 处置方式：1 降价促销 2 退货供应商 3 报废
-- 建议来源：利润分析 slowMoving（90 天无出库），人工圈选生成。

CREATE TABLE IF NOT EXISTS `inventory_disposal_orders` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `disposal_no`  VARCHAR(30)     NOT NULL COMMENT '处置单号',
  `warehouse_id` BIGINT UNSIGNED NOT NULL COMMENT '仓库',
  `warehouse_name` VARCHAR(100)  NOT NULL,
  `status`       TINYINT         NOT NULL DEFAULT 1 COMMENT '1草稿 2待审批 3已批准 4已处置 5已驳回 6已取消',
  `total_value`  DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '处置库存总价值',
  `remark`       VARCHAR(500)    DEFAULT NULL,
  `operator_id`  BIGINT UNSIGNED DEFAULT NULL,
  `operator_name` VARCHAR(50)    DEFAULT NULL,
  `approved_by`  BIGINT UNSIGNED DEFAULT NULL COMMENT '审批人',
  `approved_by_name` VARCHAR(50) DEFAULT NULL,
  `approved_at`  DATETIME        DEFAULT NULL,
  `reject_reason` VARCHAR(500)   DEFAULT NULL,
  `disposed_at`  DATETIME        DEFAULT NULL COMMENT '处置完成时间',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_disposal_no` (`disposal_no`),
  KEY `idx_disposal_wh_status` (`warehouse_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='呆滞库存处置单';

CREATE TABLE IF NOT EXISTS `inventory_disposal_items` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `disposal_id`  BIGINT UNSIGNED NOT NULL,
  `product_id`   BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50)     NOT NULL,
  `product_name` VARCHAR(150)    NOT NULL,
  `unit`         VARCHAR(20)     NOT NULL,
  `quantity`     DECIMAL(14,4)   NOT NULL COMMENT '处置数量',
  `unit_value`   DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '成本单价（avg_cost 兜底）',
  `dispose_type` TINYINT         NOT NULL DEFAULT 1 COMMENT '1降价促销 2退货供应商 3报废',
  `remark`       VARCHAR(300)    DEFAULT NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_disposal_items_disposal` (`disposal_id`),
  KEY `idx_disposal_items_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='呆滞库存处置明细';
