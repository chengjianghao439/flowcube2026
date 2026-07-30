-- FlowCube ERP - Migration 170
-- 序列号全链路事件流水（文档 04 · 4.3），仿 inventory_logs 的"每次动作一条"，是追溯查询的数据源。
--
-- 每次改 product_serials.status 或 container_id 必须同一事务追加一条 serial_events（与库存动作写 inventory_logs 同理）。

CREATE TABLE IF NOT EXISTS `serial_events` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `serial_id`    BIGINT UNSIGNED NOT NULL COMMENT 'product_serials.id',
  `event_type`   VARCHAR(32) NOT NULL COMMENT 'register/putaway/pick/ship/return_in/qa/transfer/void',
  `from_status`  TINYINT NULL,
  `to_status`    TINYINT NULL,
  `container_id` BIGINT UNSIGNED NULL,
  `warehouse_id` BIGINT UNSIGNED NULL,
  `ref_type`     VARCHAR(32) NULL COMMENT 'inbound_task / warehouse_task / sale_order / *_return',
  `ref_id`       BIGINT UNSIGNED NULL,
  `operator_id`  BIGINT UNSIGNED NULL,
  `remark`       VARCHAR(255) NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_serial` (`serial_id`,`created_at`),
  KEY `idx_ref` (`ref_type`,`ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='序列号全链路事件流水（追溯用）';
