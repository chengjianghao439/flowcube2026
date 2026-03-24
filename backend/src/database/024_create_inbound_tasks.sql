CREATE TABLE IF NOT EXISTS `inbound_tasks` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_no`            VARCHAR(30)     NOT NULL              COMMENT '任务编号 IT20260312001',
  `purchase_order_id`  BIGINT UNSIGNED NOT NULL              COMMENT '采购订单ID',
  `purchase_order_no`  VARCHAR(30)     DEFAULT NULL          COMMENT '采购订单号',
  `supplier_name`      VARCHAR(100)    DEFAULT NULL          COMMENT '供应商名称',
  `warehouse_id`       BIGINT UNSIGNED NOT NULL              COMMENT '目标仓库',
  `warehouse_name`     VARCHAR(100)    DEFAULT NULL          COMMENT '仓库名称',
  `status`             TINYINT(1)      NOT NULL DEFAULT 1    COMMENT '1=待收货 2=收货中 3=待上架 4=已完成 5=已取消',
  `operator_id`        BIGINT UNSIGNED DEFAULT NULL          COMMENT '操作员',
  `operator_name`      VARCHAR(50)     DEFAULT NULL,
  `remark`             VARCHAR(200)    DEFAULT NULL,
  `deleted_at`         DATETIME        DEFAULT NULL,
  `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_inbound_task_no` (`task_no`),
  INDEX `idx_inbound_purchase` (`purchase_order_id`),
  INDEX `idx_inbound_warehouse` (`warehouse_id`),
  INDEX `idx_inbound_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='入库任务';

CREATE TABLE IF NOT EXISTS `inbound_task_items` (
  `id`            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `task_id`       BIGINT UNSIGNED  NOT NULL              COMMENT '入库任务ID',
  `product_id`    BIGINT UNSIGNED  NOT NULL,
  `product_code`  VARCHAR(30)      DEFAULT NULL,
  `product_name`  VARCHAR(100)     NOT NULL,
  `unit`          VARCHAR(20)      DEFAULT NULL,
  `ordered_qty`   DECIMAL(12,4)    NOT NULL DEFAULT 0    COMMENT '采购数量',
  `received_qty`  DECIMAL(12,4)    NOT NULL DEFAULT 0    COMMENT '已收货数量',
  `putaway_qty`   DECIMAL(12,4)    NOT NULL DEFAULT 0    COMMENT '已上架数量',
  PRIMARY KEY (`id`),
  INDEX `idx_inbound_task` (`task_id`),
  INDEX `idx_inbound_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='入库任务明细';
