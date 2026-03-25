-- 打印调度平台：仓库维度绑定、任务优先级、确认令牌

-- 打印机服务仓库（NULL = 不限定仓库，仍可通过绑定表参与调度）
ALTER TABLE `printers`
  ADD COLUMN `warehouse_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '主要服务仓库，NULL=全局' AFTER `type`,
  ADD KEY `idx_printers_warehouse` (`warehouse_id`);

-- 用途绑定按仓：0 表示全仓默认；与具体仓库 ID 组合唯一
ALTER TABLE `printer_bindings`
  ADD COLUMN `warehouse_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=全仓默认' AFTER `id`;

ALTER TABLE `printer_bindings` DROP INDEX `uk_print_type`;
ALTER TABLE `printer_bindings` ADD UNIQUE KEY `uk_wh_print_type` (`warehouse_id`, `print_type`);

-- 任务：优先级、调度类型、上下文仓库、防丢单确认
ALTER TABLE `print_jobs`
  ADD COLUMN `priority` TINYINT NOT NULL DEFAULT 0 COMMENT '0=normal 1=high' AFTER `copies`,
  ADD COLUMN `job_type` VARCHAR(50) DEFAULT NULL COMMENT '调度键，如 product_label / inventory_label' AFTER `priority`,
  ADD COLUMN `warehouse_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '调度上下文仓库' AFTER `job_type`;

ALTER TABLE `print_jobs`
  ADD COLUMN `ack_token` CHAR(32) DEFAULT NULL COMMENT '下发打印时生成，complete 时校验' AFTER `expires_at`,
  ADD COLUMN `acknowledged_at` DATETIME DEFAULT NULL COMMENT '确认完成时间' AFTER `ack_token`;

ALTER TABLE `print_jobs`
  ADD KEY `idx_print_jobs_dispatch_queue` (`printer_id`, `status`, `priority`, `id`);
