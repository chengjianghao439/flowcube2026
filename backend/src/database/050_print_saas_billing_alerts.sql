-- 商业化 SaaS：月度计费统计、月度印量配额、策略模板标记、告警事件

ALTER TABLE `print_tenant_settings`
  ADD COLUMN `monthly_print_quota` INT UNSIGNED DEFAULT NULL COMMENT '自然月最大印量（份数/copies 口径），NULL=不限制' AFTER `max_concurrent_printing`,
  ADD COLUMN `policy_template` VARCHAR(32) DEFAULT NULL COMMENT '最近应用的策略模板：stable|speed|balanced' AFTER `lat_score_scale_ms`;

CREATE TABLE IF NOT EXISTS `print_tenant_billing_monthly` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `year_month` CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  `job_count` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '成功完成单数',
  `copy_count` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '成功完成份数合计',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`, `year_month`),
  KEY `idx_billing_month` (`year_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户打印月度计费统计';

CREATE TABLE IF NOT EXISTS `print_alert_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `alert_type` VARCHAR(32) NOT NULL COMMENT 'success_rate_low|queue_backlog|printer_degraded',
  `severity` VARCHAR(16) NOT NULL DEFAULT 'warning' COMMENT 'info|warning|critical',
  `title` VARCHAR(200) NOT NULL DEFAULT '',
  `message` VARCHAR(500) NOT NULL DEFAULT '',
  `context_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `acknowledged_at` DATETIME DEFAULT NULL,
  `acknowledged_by` BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_alert_tenant_created` (`tenant_id`, `created_at`),
  KEY `idx_alert_type_created` (`alert_type`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打印运营告警';
