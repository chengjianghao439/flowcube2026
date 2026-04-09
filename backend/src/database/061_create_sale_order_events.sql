CREATE TABLE IF NOT EXISTS sale_order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_order_id BIGINT UNSIGNED NOT NULL COMMENT '销售单ID',
  event_type VARCHAR(50) NOT NULL COMMENT '事件类型',
  title VARCHAR(100) NOT NULL COMMENT '事件标题',
  description VARCHAR(500) DEFAULT NULL COMMENT '事件说明',
  payload_json JSON DEFAULT NULL COMMENT '附加数据',
  created_by BIGINT UNSIGNED DEFAULT NULL COMMENT '操作者ID',
  created_by_name VARCHAR(100) DEFAULT NULL COMMENT '操作者名称',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sale_order_events_order (sale_order_id, created_at),
  KEY idx_sale_order_events_type (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售单事件时间线';
