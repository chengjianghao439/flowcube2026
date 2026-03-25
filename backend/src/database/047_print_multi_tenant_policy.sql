-- 多租户（tenant_id，可与业务上的 company_id 一一对应）+ 打印调度隔离

ALTER TABLE `sys_users`
  ADD COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '租户/公司 ID，0=默认单租户' AFTER `role_name`,
  ADD KEY `idx_sys_users_tenant` (`tenant_id`);

ALTER TABLE `printers`
  ADD COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=全租户共享' AFTER `warehouse_id`,
  ADD KEY `idx_printers_tenant` (`tenant_id`);

ALTER TABLE `print_jobs`
  ADD COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '租户隔离' AFTER `warehouse_id`,
  ADD KEY `idx_print_jobs_tenant` (`tenant_id`);

ALTER TABLE `printer_bindings`
  ADD COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=全租户默认绑定' AFTER `warehouse_id`;

ALTER TABLE `printer_bindings` DROP INDEX `uk_wh_print_type`;
ALTER TABLE `printer_bindings` ADD UNIQUE KEY `uk_tenant_wh_print_type` (`tenant_id`, `warehouse_id`, `print_type`);

ALTER TABLE `printer_health_stats` ADD COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '与 stats 联合主键' FIRST;
ALTER TABLE `printer_health_stats` DROP PRIMARY KEY;
ALTER TABLE `printer_health_stats` ADD PRIMARY KEY (`tenant_id`, `printer_id`);
