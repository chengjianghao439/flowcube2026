-- FlowCube ERP - Migration 165
-- 物流运单 + 轨迹（文档 06 · 电子面单与快递对接）。
--
-- 出库链路此前止步于"物理出库"，箱子出门就不再跟踪。本表把"面单打印壳 + 承运商主数据 +
-- 销售单物流字段"接上"平台取号—轨迹—对账"闭环。设计取向：**一箱一运单**（uk_package 物理挡重复取号）。
--
-- 关键点：
--  - waybill_no（内部单号 WB+日期序列）与 tracking_no（快递单号）解耦：写"待取号"记录时就生成内部单号，
--    取号成功才回写 tracking_no，取号失败/重试期间也有稳定主键可引用、可占位打印。
--  - status 是内联状态机（像 return_tasks，不进 documentStatusRules.js）：
--    1待取号 2取号中 3已取号 4取号失败 5已作废/退单；4 可重试回 2；service 内 FOR UPDATE 锁行 + CAS 推进。
--  - 取号 HTTP **绝不进业务事务**：finishPackage 事务内只 INSERT 一条 status=1 记录（零 HTTP），
--    真正取号由 scheduler 的异步 worker 事务外完成（照搬打印解耦模型）。

CREATE TABLE IF NOT EXISTS `logistics_waybills` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `waybill_no`       VARCHAR(30)     NOT NULL COMMENT '内部单号 WB+日期序列，与快递单号解耦',
  `sale_order_id`    BIGINT UNSIGNED NOT NULL COMMENT '销售单',
  `warehouse_task_id`BIGINT UNSIGNED DEFAULT NULL COMMENT '出库任务',
  `warehouse_id`     BIGINT UNSIGNED DEFAULT NULL COMMENT '发货仓库（快照，用于数据权限过滤）',
  `package_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '包裹（一箱一单）',
  `package_barcode`  VARCHAR(60)     DEFAULT NULL COMMENT '包裹条码快照',
  `carrier_id`       BIGINT UNSIGNED DEFAULT NULL,
  `carrier_name`     VARCHAR(100)    DEFAULT NULL COMMENT '承运商名快照',
  `platform_code`    VARCHAR(30)     DEFAULT NULL COMMENT '取号时快照的平台标识',
  `platform_carrier` VARCHAR(30)     DEFAULT NULL COMMENT '取号时快照的平台侧快递编码',
  `tracking_no`      VARCHAR(60)     DEFAULT NULL COMMENT '快递运单号（取号成功后回写）',
  `status`           TINYINT         NOT NULL DEFAULT 1 COMMENT '1待取号 2取号中 3已取号 4取号失败 5已作废/退单',
  `freight_type`     TINYINT         DEFAULT NULL COMMENT '快照 1寄付 2到付 3第三方付',
  `est_freight`      DECIMAL(12,4)   DEFAULT NULL COMMENT '平台预估运费',
  `receiver_name`    VARCHAR(100)    DEFAULT NULL COMMENT '收件人快照',
  `receiver_phone`   VARCHAR(50)     DEFAULT NULL,
  `receiver_address` VARCHAR(255)    DEFAULT NULL,
  `print_data_ref`   VARCHAR(60)     DEFAULT NULL COMMENT '面单打印数据类型：zpl_inline / image_url / pdf_url',
  `request_key`      VARCHAR(120)    DEFAULT NULL COMMENT '取号幂等键，防重复扣费',
  `track_status`     TINYINT         NOT NULL DEFAULT 0 COMMENT '轨迹终态标记 0未终结 1已签收（停止轮询）',
  `error_message`    VARCHAR(500)    DEFAULT NULL,
  `retry_count`      TINYINT         NOT NULL DEFAULT 0,
  `last_tried_at`    DATETIME        DEFAULT NULL,
  `created_by`       BIGINT UNSIGNED DEFAULT NULL,
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_waybill_no` (`waybill_no`),
  UNIQUE KEY `uk_package` (`package_id`),      -- 一箱一单：同一包裹只允许一条运单，DB 层挡死"连点两次取两个号"
  KEY `idx_sale_order` (`sale_order_id`),
  KEY `idx_status` (`status`),
  KEY `idx_tracking` (`tracking_no`),
  KEY `idx_warehouse` (`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='物流运单';

-- 物流轨迹事件：轮询/推送写入，uk_event 去重（重复拉取不产生重复轨迹）
CREATE TABLE IF NOT EXISTS `logistics_tracking_events` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `waybill_id`   BIGINT UNSIGNED NOT NULL,
  `tracking_no`  VARCHAR(60)     NOT NULL,
  `event_time`   DATETIME        DEFAULT NULL COMMENT '快递侧事件时间',
  `status_code`  VARCHAR(30)     DEFAULT NULL COMMENT '平台轨迹状态码，归一到内部枚举',
  `description`  VARCHAR(500)    DEFAULT NULL,
  `location`     VARCHAR(255)    DEFAULT NULL,
  `event_hash`   VARCHAR(64)     DEFAULT NULL COMMENT '去重：hash(tracking_no+event_time+description)',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_event` (`waybill_id`,`event_hash`),
  KEY `idx_tracking` (`tracking_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='物流轨迹事件';
