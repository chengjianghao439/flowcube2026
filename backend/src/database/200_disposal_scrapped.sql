-- FlowCube ERP - Migration 200
-- 呆滞库存处置（P2-9）：报废台账。
--
-- 处置单执行时三种处置方式（降价促销/退货供应商/报废）都走「FIFO 扣容器 + 写 inventory_logs」，
-- 其中报废是资产灭失，除扣库存外另落本台账留痕（审计证据）。
-- 台账只作审计，账仍以容器事实表与流水为准，不做二次库存记录。

CREATE TABLE IF NOT EXISTS `disposal_scrapped` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `disposal_id`     BIGINT UNSIGNED NOT NULL COMMENT '处置单 id',
  `disposal_no`     VARCHAR(30)     NOT NULL COMMENT '处置单号',
  `product_id`      BIGINT UNSIGNED NOT NULL,
  `product_code`    VARCHAR(50)     NOT NULL,
  `product_name`    VARCHAR(150)    NOT NULL,
  `unit`            VARCHAR(20)     NOT NULL,
  `quantity`        DECIMAL(14,4)   NOT NULL COMMENT '报废数量',
  `unit_value`      DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '成本单价快照',
  `warehouse_id`    BIGINT UNSIGNED NOT NULL,
  `warehouse_name`  VARCHAR(100)    NOT NULL,
  `remark`          VARCHAR(500)    DEFAULT NULL,
  `scrapped_by`     BIGINT UNSIGNED DEFAULT NULL,
  `scrapped_by_name` VARCHAR(50)    DEFAULT NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_disposal_scrapped_disposal` (`disposal_id`),
  KEY `idx_disposal_scrapped_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='呆滞处置报废台账';
