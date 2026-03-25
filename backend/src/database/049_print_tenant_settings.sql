-- 租户打印配额与策略配置（商业化多租户）

CREATE TABLE IF NOT EXISTS `print_tenant_settings` (
  `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '与 sys_users.tenant_id 一致，0 表示默认租户',
  `max_queue_jobs` INT UNSIGNED DEFAULT NULL COMMENT '排队+打印中任务上限，NULL=不限制',
  `max_concurrent_printing` INT UNSIGNED DEFAULT NULL COMMENT '同时打印中任务上限，NULL=不限制',
  `exploration_mode` VARCHAR(16) NOT NULL DEFAULT 'adaptive' COMMENT 'adaptive=自适应 fixed=固定探索率',
  `exploration_rate` DECIMAL(12,8) DEFAULT NULL COMMENT 'fixed 模式下探索率 0~1',
  `exploration_min` DECIMAL(12,8) DEFAULT NULL COMMENT 'adaptive 下界覆盖',
  `exploration_max` DECIMAL(12,8) DEFAULT NULL,
  `exploration_base` DECIMAL(12,8) DEFAULT NULL,
  `exploration_k_err` DECIMAL(12,8) DEFAULT NULL,
  `exploration_k_lat` DECIMAL(12,8) DEFAULT NULL,
  `exploration_lat_norm_ms` INT UNSIGNED DEFAULT NULL,
  `weight_err` DECIMAL(12,8) DEFAULT NULL COMMENT '调度分：错误率权重',
  `weight_lat` DECIMAL(12,8) DEFAULT NULL COMMENT '调度分：延迟权重',
  `weight_hb` DECIMAL(12,8) DEFAULT NULL COMMENT '调度分：心跳权重',
  `lat_score_scale_ms` INT UNSIGNED DEFAULT NULL COMMENT '延迟衰减尺度 ms',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户打印配额与调度策略';
