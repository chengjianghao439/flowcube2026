-- 智能调度：幂等键、调度原因、下发时间、打印机健康度

ALTER TABLE `print_jobs`
  ADD COLUMN `job_unique_key` VARCHAR(160) DEFAULT NULL COMMENT '业务幂等键，防重复创建' AFTER `warehouse_id`,
  ADD COLUMN `dispatch_reason` VARCHAR(32) DEFAULT NULL COMMENT 'binding|fallback|load_balance|explicit' AFTER `job_unique_key`,
  ADD COLUMN `dispatched_at` DATETIME DEFAULT NULL COMMENT '进入打印中时间，用于延迟统计' AFTER `dispatch_reason`,
  ADD KEY `idx_print_jobs_unique_key` (`job_unique_key`);

CREATE TABLE IF NOT EXISTS `printer_health_stats` (
  `printer_id`     BIGINT UNSIGNED NOT NULL,
  `error_rate`     DECIMAL(8,6)    NOT NULL DEFAULT 0.000000 COMMENT '失败率 EWMA 0~1',
  `avg_latency_ms` INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '完成耗时 EWMA(ms)',
  `sample_count`   INT UNSIGNED    NOT NULL DEFAULT 0,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`printer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打印机健康度（调度参考）';
