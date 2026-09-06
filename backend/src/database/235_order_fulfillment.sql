CREATE TABLE IF NOT EXISTS order_delivery_commitments (
  document_type VARCHAR(20) NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  promised_date DATE NULL,
  original_date DATE NULL,
  processing_days INT UNSIGNED NULL COMMENT '收货上架至可发/现货作业所需自然日；NULL 表示未确认',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (document_type, document_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_fulfillment_issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_type VARCHAR(20) NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(100) NOT NULL,
  source VARCHAR(10) NOT NULL,
  title VARCHAR(100) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  action_path VARCHAR(200) NOT NULL,
  owner_id BIGINT UNSIGNED NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  due_at DATETIME NULL,
  result VARCHAR(500) NULL,
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uk_issue_source (document_type,document_id,source_key),
  KEY idx_issue_owner (owner_id,status,due_at,id),
  KEY idx_issue_document (document_type,document_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_fulfillment_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_type VARCHAR(20) NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  issue_id BIGINT UNSIGNED NULL,
  title VARCHAR(100) NOT NULL,
  description VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_by_name VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fulfillment_events (document_type,document_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
