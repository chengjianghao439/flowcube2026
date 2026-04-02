ALTER TABLE `print_jobs`
  ADD COLUMN `ref_type` VARCHAR(50) DEFAULT NULL COMMENT '业务引用类型：inventory_container/package/waybill/product/rack' AFTER `dispatch_reason`,
  ADD COLUMN `ref_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '业务引用主键' AFTER `ref_type`,
  ADD COLUMN `ref_code` VARCHAR(100) DEFAULT NULL COMMENT '业务引用条码/编码' AFTER `ref_id`,
  ADD KEY `idx_print_jobs_ref_lookup` (`tenant_id`, `ref_type`, `ref_id`, `id`),
  ADD KEY `idx_print_jobs_ref_code` (`tenant_id`, `ref_type`, `ref_code`);
