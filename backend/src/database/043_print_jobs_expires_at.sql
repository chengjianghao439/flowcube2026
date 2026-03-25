-- 打印任务过期时间：超时仍未完成（pending/printing）则清扫为 failed

ALTER TABLE `print_jobs`
  ADD COLUMN `expires_at` DATETIME DEFAULT NULL COMMENT '超过此时仍未完成则视为超时失败' AFTER `error_message`;

CREATE INDEX `idx_print_jobs_expires` ON `print_jobs` (`expires_at`, `status`);
