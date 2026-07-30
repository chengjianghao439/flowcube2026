-- FlowCube ERP - Migration 169
-- 序列号个体主表（文档 04 · 4.2）。每台一行，记录它**当前**的归属与状态；历史流转看 serial_events。
--
-- 硬边界（不变量）：status=1 在库 的行必须挂在某容器上，且「某容器在库序列号行数 == 该容器 remaining_qty」。
-- 唯一键 (product_id, serial_no)：同一商品同一序列号不能同时两台在库；允许出库→退货→再入库复用同一行改状态。

CREATE TABLE IF NOT EXISTS `product_serials` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`      BIGINT UNSIGNED NOT NULL,
  `serial_no`       VARCHAR(64) NOT NULL COMMENT '序列号/机身码/IMEI，扫码原文',
  `warehouse_id`    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前所在仓；已出库时保留最后所在仓',
  `container_id`    BIGINT UNSIGNED NULL COMMENT '当前所在容器；已出库/已退待处理时为 NULL',
  `status`          TINYINT NOT NULL DEFAULT 1 COMMENT '1在库 2已出库 3已退货(待处理)',
  -- 来源（收货登记）
  `inbound_task_id`      BIGINT UNSIGNED NULL COMMENT '登记时所在收货订单',
  `inbound_task_item_id` BIGINT UNSIGNED NULL COMMENT '归属收货明细行（对齐容器 inbound_task_item_id）',
  `purchase_order_id`    BIGINT UNSIGNED NULL COMMENT '溯源采购单',
  -- 出库（核销时回写）
  `warehouse_task_id`    BIGINT UNSIGNED NULL COMMENT '出库任务',
  `sale_order_id`        BIGINT UNSIGNED NULL COMMENT '销售单',
  `shipped_at`           DATETIME NULL,
  -- 退货
  `return_ref_type`      VARCHAR(32) NULL COMMENT 'sale_return / purchase_return',
  `return_ref_id`        BIGINT UNSIGNED NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_serial` (`product_id`,`serial_no`),
  KEY `idx_serial_no` (`serial_no`),
  KEY `idx_container` (`container_id`),
  KEY `idx_status_wh` (`status`,`warehouse_id`),
  KEY `idx_sale_order` (`sale_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='序列号个体主表（容器下挂个体，数量以容器为准）';
