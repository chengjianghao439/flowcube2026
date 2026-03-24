-- 巡检执行摘要表
-- 每次调用 runAllChecks() 产生一条记录，存储执行结果的聚合信息
-- system_health_logs 存储明细，本表存储每次巡检的"封面"
CREATE TABLE IF NOT EXISTS `system_health_runs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id`       CHAR(36)        NOT NULL UNIQUE COMMENT '与 system_health_logs.run_id 关联',
  `triggered_by` ENUM('manual','scheduler') NOT NULL DEFAULT 'manual',
  `started_at`   DATETIME        NOT NULL,
  `elapsed_ms`   INT UNSIGNED    NOT NULL DEFAULT 0,
  `total_issues` INT UNSIGNED    NOT NULL DEFAULT 0,
  `high_count`   INT UNSIGNED    NOT NULL DEFAULT 0,
  `medium_count` INT UNSIGNED    NOT NULL DEFAULT 0,
  `low_count`    INT UNSIGNED    NOT NULL DEFAULT 0,
  `has_high`     TINYINT(1)      NOT NULL DEFAULT 0,
  `check_errors` TEXT                NULL COMMENT 'JSON 序列化的检查项执行错误',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_started_at` (`started_at`),
  KEY `idx_has_high`   (`has_high`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
