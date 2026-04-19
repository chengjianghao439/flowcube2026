CREATE TABLE IF NOT EXISTS `operation_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_key` VARCHAR(80) NOT NULL,
  `action` VARCHAR(80) NOT NULL,
  `user_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '0=pending 1=success 2=failed',
  `response_json` LONGTEXT DEFAULT NULL,
  `response_message` VARCHAR(200) DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `resource_type` VARCHAR(40) DEFAULT NULL,
  `resource_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_operation_requests_key` (`request_key`, `action`, `user_id`),
  KEY `idx_operation_requests_lookup` (`user_id`, `action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
