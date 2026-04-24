CREATE TABLE IF NOT EXISTS transfer_order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transfer_order_id BIGINT UNSIGNED NOT NULL COMMENT '调拨单ID',
  order_no VARCHAR(50) NOT NULL COMMENT '调拨单号',
  event_type VARCHAR(50) NOT NULL COMMENT '事件类型',
  title VARCHAR(100) NOT NULL COMMENT '事件标题',
  description VARCHAR(255) DEFAULT NULL COMMENT '事件描述',
  payload_json JSON DEFAULT NULL COMMENT '事件扩展数据',
  created_by BIGINT UNSIGNED DEFAULT NULL COMMENT '操作人ID',
  created_by_name VARCHAR(100) DEFAULT NULL COMMENT '操作人名称',
  request_id VARCHAR(64) DEFAULT NULL COMMENT '请求ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transfer_order_events_order (transfer_order_id, created_at),
  KEY idx_transfer_order_events_type (event_type),
  KEY idx_transfer_order_events_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调拨单事件时间线';

CREATE TABLE IF NOT EXISTS return_order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  return_type VARCHAR(20) NOT NULL COMMENT 'purchase|sale',
  return_id BIGINT UNSIGNED NOT NULL COMMENT '退货单ID',
  return_no VARCHAR(50) NOT NULL COMMENT '退货单号',
  event_type VARCHAR(50) NOT NULL COMMENT '事件类型',
  title VARCHAR(100) NOT NULL COMMENT '事件标题',
  description VARCHAR(255) DEFAULT NULL COMMENT '事件描述',
  payload_json JSON DEFAULT NULL COMMENT '事件扩展数据',
  created_by BIGINT UNSIGNED DEFAULT NULL COMMENT '操作人ID',
  created_by_name VARCHAR(100) DEFAULT NULL COMMENT '操作人名称',
  request_id VARCHAR(64) DEFAULT NULL COMMENT '请求ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_return_order_events_ref (return_type, return_id, created_at),
  KEY idx_return_order_events_type (event_type),
  KEY idx_return_order_events_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='退货单事件时间线';

CREATE TABLE IF NOT EXISTS payment_record_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_record_id BIGINT UNSIGNED NOT NULL COMMENT '账款记录ID',
  order_no VARCHAR(50) DEFAULT NULL COMMENT '业务单号',
  event_type VARCHAR(50) NOT NULL COMMENT '事件类型',
  title VARCHAR(100) NOT NULL COMMENT '事件标题',
  description VARCHAR(255) DEFAULT NULL COMMENT '事件描述',
  payload_json JSON DEFAULT NULL COMMENT '事件扩展数据',
  created_by BIGINT UNSIGNED DEFAULT NULL COMMENT '操作人ID',
  created_by_name VARCHAR(100) DEFAULT NULL COMMENT '操作人名称',
  request_id VARCHAR(64) DEFAULT NULL COMMENT '请求ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_record_events_record (payment_record_id, created_at),
  KEY idx_payment_record_events_type (event_type),
  KEY idx_payment_record_events_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账款记录事件时间线';

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type VARCHAR(50) NOT NULL COMMENT '审计事件类型',
  title VARCHAR(100) NOT NULL COMMENT '事件标题',
  description VARCHAR(255) DEFAULT NULL COMMENT '事件描述',
  payload_json JSON DEFAULT NULL COMMENT '事件扩展数据',
  user_id BIGINT UNSIGNED DEFAULT NULL COMMENT '用户ID',
  username VARCHAR(100) DEFAULT NULL COMMENT '用户名',
  request_id VARCHAR(64) DEFAULT NULL COMMENT '请求ID',
  method VARCHAR(16) DEFAULT NULL COMMENT '请求方法',
  path VARCHAR(255) DEFAULT NULL COMMENT '请求路径',
  ip VARCHAR(128) DEFAULT NULL COMMENT '来源IP',
  user_agent VARCHAR(255) DEFAULT NULL COMMENT 'User-Agent',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_auth_audit_logs_event (event_type, created_at),
  KEY idx_auth_audit_logs_user (user_id, created_at),
  KEY idx_auth_audit_logs_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='鉴权审计日志';
