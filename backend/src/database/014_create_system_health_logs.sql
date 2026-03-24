-- 系统健康巡检日志表
-- 每次调用 GET /api/system/health 时，本次发现的异常写入此表
-- 历史记录永久保留，供趋势分析
CREATE TABLE IF NOT EXISTS `system_health_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id`      CHAR(36)        NOT NULL COMMENT '同一次巡检的 UUID，用于批量查询',
  `check_type`  VARCHAR(60)     NOT NULL COMMENT '检查项类型标识',
  `severity`    ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  `related_id`  BIGINT UNSIGNED     NULL COMMENT '关联的业务记录 ID',
  `related_table` VARCHAR(60)   NULL COMMENT '关联的业务表名',
  `message`     VARCHAR(500)    NOT NULL COMMENT '异常描述',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_run_id`    (`run_id`),
  KEY `idx_check_type` (`check_type`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
