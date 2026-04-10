ALTER TABLE `inbound_tasks`
  ADD COLUMN `submitted_at` DATETIME NULL COMMENT '提交到PDA时间' AFTER `remark`,
  ADD COLUMN `submitted_by` BIGINT UNSIGNED NULL COMMENT '提交到PDA操作人ID' AFTER `submitted_at`,
  ADD COLUMN `submitted_by_name` VARCHAR(50) NULL COMMENT '提交到PDA操作人' AFTER `submitted_by`,
  ADD COLUMN `audit_status` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0待审核 1已审核 2已退回' AFTER `submitted_by_name`,
  ADD COLUMN `audit_remark` VARCHAR(200) NULL COMMENT '审核备注' AFTER `audit_status`,
  ADD COLUMN `audited_at` DATETIME NULL COMMENT '审核时间' AFTER `audit_remark`,
  ADD COLUMN `audited_by` BIGINT UNSIGNED NULL COMMENT '审核人ID' AFTER `audited_at`,
  ADD COLUMN `audited_by_name` VARCHAR(50) NULL COMMENT '审核人' AFTER `audited_by`;

CREATE TABLE IF NOT EXISTS `inbound_task_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL COMMENT '收货订单ID',
  `event_type` VARCHAR(50) NOT NULL COMMENT '事件类型',
  `title` VARCHAR(100) NOT NULL COMMENT '事件标题',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '事件描述',
  `payload_json` JSON DEFAULT NULL COMMENT '事件扩展数据',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '操作人ID',
  `created_by_name` VARCHAR(50) DEFAULT NULL COMMENT '操作人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inbound_task_events_task` (`task_id`, `created_at`),
  KEY `idx_inbound_task_events_type` (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收货订单时间线事件';
