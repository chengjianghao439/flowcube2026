-- 幂等查询加速：(job_unique_key, warehouse_id, job_type) + 状态

CREATE INDEX `idx_print_jobs_idem_scope` ON `print_jobs` (`job_unique_key`, `warehouse_id`, `job_type`, `status`);
