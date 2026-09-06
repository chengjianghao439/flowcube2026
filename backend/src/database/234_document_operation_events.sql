CREATE TABLE IF NOT EXISTS document_operation_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_type VARCHAR(32) NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  operation_log_id BIGINT UNSIGNED DEFAULT NULL,
  title VARCHAR(100) NOT NULL,
  description VARCHAR(500) DEFAULT NULL,
  created_by BIGINT UNSIGNED DEFAULT NULL,
  created_by_name VARCHAR(100) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_document_activity (document_type, document_id, id),
  UNIQUE KEY uk_document_operation_log (operation_log_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单操作记录，独立于系统日志清理保留';
