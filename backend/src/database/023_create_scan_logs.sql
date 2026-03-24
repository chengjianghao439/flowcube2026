CREATE TABLE IF NOT EXISTS `scan_logs` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id`       BIGINT UNSIGNED NOT NULL              COMMENT '仓库任务ID',
  `item_id`       BIGINT UNSIGNED NOT NULL              COMMENT '任务明细ID',
  `container_id`  BIGINT UNSIGNED NOT NULL              COMMENT '容器ID',
  `barcode`       VARCHAR(30)     NOT NULL              COMMENT '容器条码',
  `product_id`    BIGINT UNSIGNED NOT NULL              COMMENT '商品ID',
  `qty`           DECIMAL(12,4)   NOT NULL DEFAULT 0    COMMENT '扫描数量',
  `scan_mode`     VARCHAR(20)     NOT NULL              COMMENT '整件 / 散件',
  `operator_id`   BIGINT UNSIGNED DEFAULT NULL          COMMENT '操作员ID',
  `operator_name` VARCHAR(50)     DEFAULT NULL          COMMENT '操作员姓名',
  `location_code` VARCHAR(20)     DEFAULT NULL          COMMENT '容器所在库位',
  `scanned_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_scan_task`      (`task_id`),
  INDEX `idx_scan_container` (`container_id`),
  INDEX `idx_scan_time`      (`scanned_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PDA 扫描记录';
